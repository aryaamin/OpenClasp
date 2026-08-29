import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { MemoryAuditStore, TrustEngine } from '../packages/core/src/index.js';
import {
  OPENCLASP_MCP_INSTRUCTIONS,
  registerOpenClaspTools,
} from '../packages/mcp-server/src/server.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';
import { verifyAuth0Token } from './auth0.js';
import { oauthStore } from './oauth-store.js';

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
  if (bearerToken.startsWith('oc_oat_')) {
    const authentication = await oauthStore().verifyAccessToken(bearerToken);
    if (!authentication || !authentication.scopes.includes('mcp:access'))
      throw new Error('OpenClasp OAuth token is invalid or missing the MCP scope');
    return {
      token: bearerToken,
      clientId: authentication.clientId,
      scopes: authentication.scopes,
      expiresAt: Math.floor(Date.parse(authentication.expiresAt) / 1000),
      extra: {
        operatorId: authentication.operatorId,
        credentialType: 'oauth_access_token',
      },
    };
  }
  if (bearerToken.startsWith('oc_at_')) {
    if (!repository) throw new Error('Agent access tokens are not configured');
    const authentication = await repository.verifyAgentAccessToken(bearerToken);
    if (!authentication.scopes.includes('mcp:access'))
      throw new Error('Agent access token is missing the MCP scope');
    return {
      token: bearerToken,
      clientId: authentication.clientId,
      scopes: authentication.scopes,
      expiresAt: Math.floor(Date.parse(authentication.expiresAt) / 1000),
      extra: {
        operatorId: authentication.operatorId,
        boundAgentId: authentication.agentId,
        credentialType: 'agent_access_token',
      },
    };
  }
  const authentication = await verifyAuth0Token(bearerToken, {
    dashboard: false,
    requiredScopes: ['mcp:access'],
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

const resourceMetadataPath = '/.well-known/oauth-protected-resource/mcp';

const authenticatedHandler = withMcpAuth(mcp, verifyToken, {
  required: true,
  resourceMetadataPath,
  ...(process.env.OPENCLASP_MCP_URL
    ? { resourceUrl: new URL(process.env.OPENCLASP_MCP_URL).origin }
    : {}),
});

async function handler(request: Request): Promise<Response> {
  const response = await authenticatedHandler(request);
  if (response.status !== 401 || request.headers.get('authorization')?.trim()) return response;

  // A missing credential is an authentication discovery challenge, not an invalid token.
  // Cursor's V2 MCP client treats `invalid_token` while auth is still unknown as a
  // transient connection failure instead of starting OAuth.
  const configuredResource = process.env.OPENCLASP_MCP_URL;
  const publicOrigin = configuredResource
    ? new URL(configuredResource).origin
    : new URL(request.url).origin;
  const headers = new Headers(response.headers);
  headers.set(
    'www-authenticate',
    `Bearer resource_metadata="${new URL(resourceMetadataPath, publicOrigin).href}", scope="mcp:access"`,
  );
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  headers.delete('content-type');
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { handler as GET, handler as POST };
