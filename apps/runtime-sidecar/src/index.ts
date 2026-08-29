import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  LiveSessionActivationSchema,
  type LiveSessionActivation,
} from '../../../packages/protocol/src/index.js';
import {
  createAgentRuntimeConnector,
  HttpAgentRuntimeAdapter,
  OpenClaspClient,
  type RuntimeSessionStore,
} from '../../../packages/sdk/src/index.js';

class JsonFileRuntimeSessionStore implements RuntimeSessionStore {
  private loading: Promise<void> | undefined;
  private readonly sessions = new Map<string, LiveSessionActivation>();
  private writes = Promise.resolve();

  private readonly key: Buffer;

  constructor(
    private readonly filename: string,
    encryptionSecret: string,
  ) {
    this.key = createHash('sha256')
      .update(`openclasp-runtime-sessions:${encryptionSecret}`)
      .digest();
  }

  private async load() {
    this.loading ??= (async () => {
      try {
        const envelope = JSON.parse(await readFile(this.filename, 'utf8')) as {
          version: number;
          iv: string;
          authTag: string;
          ciphertext: string;
        };
        if (envelope.version !== 1) throw new Error('Unsupported runtime session file');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          this.key,
          Buffer.from(envelope.iv, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
        const values = JSON.parse(plaintext) as unknown[];
        for (const value of values) {
          const session = LiveSessionActivationSchema.parse(value);
          this.sessions.set(session.interactionId, session);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })();
    await this.loading;
  }

  async get(interactionId: string) {
    await this.load();
    return this.sessions.get(interactionId);
  }

  async put(interactionId: string, session: LiveSessionActivation) {
    await this.load();
    this.sessions.set(interactionId, LiveSessionActivationSchema.parse(session));
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${process.pid}.tmp`;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify([...this.sessions.values()])),
        cipher.final(),
      ]);
      await writeFile(
        temporary,
        JSON.stringify({
          version: 1,
          iv: iv.toString('base64url'),
          authTag: cipher.getAuthTag().toString('base64url'),
          ciphertext: ciphertext.toString('base64url'),
        }),
        { mode: 0o600 },
      );
      await rename(temporary, this.filename);
    });
    await this.writes;
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sdkBaseUrl(value: string) {
  return `${value.replace(/\/$/, '').replace(/\/v0\.1$/, '')}/v0.1`;
}

function requestHeaders(headers: IncomingHttpHeaders) {
  const output = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const entry of value) output.append(name, entry);
    else if (value !== undefined) output.set(name, value);
  }
  return output;
}

async function readBody(request: NodeJS.ReadableStream, maximumBytes = 2_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.byteLength;
    if (size > maximumBytes) throw new Error('Request body is too large');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const accessToken = required('OPENCLASP_AGENT_TOKEN');
const runtimeUrl = new URL(required('OPENCLASP_RUNTIME_URL'));
if (runtimeUrl.protocol !== 'https:') throw new Error('OPENCLASP_RUNTIME_URL must use HTTPS');
const agentAdapterUrl = required('AGENT_ADAPTER_URL');
const openClaspUrl = process.env.OPENCLASP_URL?.trim() || 'https://openclasp.vercel.app';
const client = new OpenClaspClient(sdkBaseUrl(openClaspUrl), accessToken);
const bootstrap = await client.getRuntimeBootstrap();
const sessions = new JsonFileRuntimeSessionStore(
  process.env.OPENCLASP_SESSION_FILE?.trim() || './data/openclasp-sessions.json',
  process.env.OPENCLASP_SESSION_SECRET?.trim() || accessToken,
);
const adapter = new HttpAgentRuntimeAdapter(agentAdapterUrl, {
  ...(process.env.AGENT_ADAPTER_TOKEN?.trim()
    ? { bearerToken: process.env.AGENT_ADAPTER_TOKEN.trim() }
    : {}),
  timeoutMs: Number(process.env.AGENT_ADAPTER_TIMEOUT_MS ?? 30_000),
});
const handler = createAgentRuntimeConnector({
  agentId: bootstrap.agentId,
  a2aEndpoint: runtimeUrl.toString(),
  openClaspUrl,
  adapter,
  sessions,
});

let ready = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', runtimeUrl).pathname;
  if (request.method === 'GET' && (path === '/health' || path === '/ready')) {
    const status = path === '/health' || ready ? 200 : 503;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: status === 200 ? 'ready' : 'starting' }));
    return;
  }
  if (request.method !== 'POST' || path !== runtimeUrl.pathname) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  try {
    const body = await readBody(request);
    const result = await handler(
      new Request(runtimeUrl, {
        method: 'POST',
        headers: requestHeaders(request.headers),
        body,
      }),
    );
    const headers: Record<string, string> = {};
    result.headers.forEach((value, name) => (headers[name] = value));
    response.writeHead(result.status, headers);
    response.end(await result.text());
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ error: error instanceof Error ? error.message : 'runtime_failed' }),
    );
  }
});

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST?.trim() || '0.0.0.0';
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, resolve);
});

await client.connectRuntime(runtimeUrl.toString());
ready = true;
console.log(`OpenClasp runtime connected for ${bootstrap.agentId} at ${runtimeUrl.toString()}`);

const heartbeat = setInterval(() => void client.heartbeatRuntime().catch(() => undefined), 60_000);
heartbeat.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(heartbeat);
    server.close(() => process.exit(0));
  });
}
