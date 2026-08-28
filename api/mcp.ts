import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { MemoryAuditStore, TrustEngine } from '../packages/core/src/index.js';
import {
  OPENCLASP_MCP_INSTRUCTIONS,
  registerOpenClaspTools,
} from '../packages/mcp-server/src/server.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';
import { verifyAuth0Token } from './auth0.js';

const repository = process.env.DATABASE_URL
  ? new HostedRepository(process.env.DATABASE_URL)
  : undefined;
const engines = new Map<string, Promise<TrustEngine>>();

function engineFor(context: { http?: { authInfo?: { extra?: Record<string, unknown> } } }) {
  const operatorId =
    context.http?.authInfo?.extra?.operatorId ?? context.http?.authInfo?.extra?.userId;
  if (typeof operatorId !== 'string' || !repository) return Promise.resolve(new TrustEngine());
  let pending = engines.get(operatorId);
  if (!pending) {
    pending = repository.list(operatorId).then((rows) => {
      const store = new MemoryAuditStore();
      for (const row of rows) {
        if (row.kind !== 'interaction') store.append(row.kind, row.recordId, row.payload);
      }
      return new TrustEngine(store);
    });
    engines.set(operatorId, pending);
  }
  return pending;
}

const mcp = createMcpHandler(
  (server) =>
    registerOpenClaspTools(
      server,
      engineFor,
      repository
        ? (operatorId, kind, recordId, value) =>
            repository.upsert(operatorId, kind, recordId, value)
        : undefined,
      repository,
      repository,
    ),
  {
    serverInfo: { name: 'openclasp', version: '0.1.0' },
    instructions: OPENCLASP_MCP_INSTRUCTIONS,
  },
);

async function verifyToken(_request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const authentication = await verifyAuth0Token(bearerToken, {
    dashboard: false,
  });
  return {
    token: bearerToken,
    clientId: authentication.clientId,
    scopes: authentication.scopes,
    ...(typeof authentication.payload.exp === 'number'
      ? { expiresAt: authentication.payload.exp }
      : {}),
    extra: { operatorId: authentication.payload.sub },
  };
}

const handler = withMcpAuth(mcp, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
  ...(process.env.OPENCLASP_MCP_URL
    ? { resourceUrl: new URL(process.env.OPENCLASP_MCP_URL).origin }
    : {}),
});

export { handler as GET, handler as POST };
