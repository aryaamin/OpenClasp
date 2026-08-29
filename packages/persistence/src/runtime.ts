import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const RESPONSE_LIMIT = 64 * 1024;

function isPrivateIpv4(address: string) {
  const values = address.split('.').map(Number);
  const [a, b] = values;
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value))) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a! >= 224
  );
}

function isPrivateIp(address: string) {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7));
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('2001:db8:')
  );
}

export async function resolvePublicRuntimeEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Runtime endpoint must use HTTPS');
  if (url.username || url.password) throw new Error('Runtime endpoint cannot contain credentials');
  if (url.port && url.port !== '443') throw new Error('Runtime endpoint must use port 443');
  if (isIP(url.hostname) || url.hostname === 'localhost' || url.hostname.endsWith('.local'))
    throw new Error('Runtime endpoint must use a public DNS hostname');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address)))
    throw new Error('Runtime endpoint resolves to a private or reserved network');
  return { url, address: addresses[0]!.address };
}

export async function postRuntimeJson(
  endpoint: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const target = await resolvePublicRuntimeEndpoint(endpoint);
  const encoded = JSON.stringify(body);
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname: target.address,
        port: 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'POST',
        servername: target.url.hostname,
        headers: {
          host: target.url.host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(encoded),
          ...headers,
        },
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > RESPONSE_LIMIT) request.destroy(new Error('Runtime response is too large'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = undefined;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }
          resolve({ status: response.statusCode ?? 500, body: parsed });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Runtime endpoint timed out')));
    request.on('error', reject);
    request.end(encoded);
  });
}

export function runtimeDeliverySignature(
  secret: string,
  deliveryId: string,
  timestamp: string,
  body: string,
) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest('base64url');
}

export function verifyRuntimeDeliverySignature(
  secret: string,
  deliveryId: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
) {
  if (Math.abs(now - Date.parse(timestamp)) > 5 * 60_000) return false;
  const expected = Buffer.from(
    runtimeDeliverySignature(secret, deliveryId, timestamp, body),
    'base64url',
  );
  const actual = Buffer.from(signature.replace(/^v1=/, ''), 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
