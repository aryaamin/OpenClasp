import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { canonicalHash } from '../../protocol/src/index.js';

export type GatewayGrant = {
  interactionId: string;
  senderAgentId: string;
  recipientAgentId: string;
  expiresAt: number;
};

const keyFromSecret = (secret: string) => createHash('sha256').update(secret).digest();

export function encryptGatewayPayload(secret: string, payload: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptGatewayPayload(
  secret: string,
  encrypted: { ciphertext: string; iv: string; authTag: string },
): unknown {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromSecret(secret),
    Buffer.from(encrypted.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  );
}

export function issueGatewayGrant(secret: string, grant: GatewayGrant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGatewayGrant(secret: string, token: string): GatewayGrant {
  const [payload, provided] = token.split('.');
  if (!payload || !provided) throw new Error('Invalid gateway token');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(provided, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error('Invalid gateway token');
  const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GatewayGrant;
  if (grant.expiresAt <= Date.now()) throw new Error('Gateway token expired');
  if (!grant.interactionId || !grant.senderAgentId || !grant.recipientAgentId)
    throw new Error('Invalid gateway token');
  return grant;
}

function sessionPrivateKey(secret: string) {
  const seed = createHash('sha256').update(`openclasp:live-session:${secret}`).digest();
  return createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    type: 'pkcs8',
    format: 'der',
  });
}

export function getSessionVerificationKey(secret: string) {
  return createPublicKey(sessionPrivateKey(secret))
    .export({ type: 'spki', format: 'der' })
    .toString('base64url');
}

export function getSessionKeyId(secret: string) {
  return `openclasp:${createHash('sha256')
    .update(getSessionVerificationKey(secret))
    .digest('base64url')
    .slice(0, 16)}`;
}

export function attestSessionRecord(secret: string, value: unknown) {
  const digest = canonicalHash(value);
  return {
    algorithm: 'Ed25519' as const,
    keyId: getSessionKeyId(secret),
    value: sign(null, Buffer.from(digest), sessionPrivateKey(secret)).toString('base64url'),
    digest,
  };
}

export function signSessionControl(
  secret: string,
  requestId: string,
  timestamp: string,
  body: string,
) {
  return sign(
    null,
    Buffer.from(`${timestamp}.${requestId}.${body}`),
    sessionPrivateKey(secret),
  ).toString('base64url');
}

export function issueSessionGrant(secret: string, grant: GatewayGrant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  const signature = sign(null, Buffer.from(payload), sessionPrivateKey(secret)).toString(
    'base64url',
  );
  return `${payload}.${signature}`;
}

export function verifySessionGrant(secret: string, token: string): GatewayGrant {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new Error('Invalid live-session credential');
  const valid = verify(
    null,
    Buffer.from(payload),
    createPublicKey(sessionPrivateKey(secret)),
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw new Error('Invalid live-session credential');
  const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GatewayGrant;
  if (grant.expiresAt <= Date.now()) throw new Error('Live-session credential expired');
  if (!grant.interactionId || !grant.senderAgentId || !grant.recipientAgentId)
    throw new Error('Invalid live-session credential');
  return grant;
}
