import { createClerkClient } from '@clerk/backend';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { MemoryAuditStore, TrustEngine } from '../packages/core/src/index.js';
import { registerOpenClaspTools } from '../packages/mcp-server/src/server.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';

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
    ),
  {
    serverInfo: { name: 'openclasp', version: '0.1.0' },
    instructions:
      'OpenClasp provides identity, interaction assurance, private clues, receipts, and contextual behavioural history. Never submit raw private conversations.',
  },
);

async function verifyToken(request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey || !bearerToken) return undefined;
  const state = await createClerkClient({ secretKey, publishableKey }).authenticateRequest(
    request,
    {
      acceptsToken: 'oauth_token',
    },
  );
  if (!state.isAuthenticated) return undefined;
  const authInfo = verifyClerkToken(state.toAuth(), bearerToken);
  if (!authInfo) return undefined;
  return { ...authInfo, extra: { ...authInfo.extra, operatorId: state.toAuth().userId } };
}

const handler = withMcpAuth(mcp, verifyToken, {
  required: true,
  requiredScopes: ['profile'],
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
  ...(process.env.OPENCLASP_MCP_URL
    ? { resourceUrl: new URL(process.env.OPENCLASP_MCP_URL).origin }
    : {}),
});

export { handler as GET, handler as POST };
