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
import {
  DEFAULT_MCP_AUTH_SCOPES,
  assertScopes,
  requiredMcpRequestScopes,
} from './access-control.js';
import { guardRequest } from './request-security.js';
import { assertProductionConfiguration } from './production-config.js';

assertProductionConfiguration('mcp');

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
    verboseLogs: true,
  },
);

async function verifyToken(request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const requiredScopes = await requiredMcpRequestScopes(request);
  if (bearerToken.startsWith('oc_oat_')) {
    const authentication = await oauthStore().verifyAccessToken(bearerToken);
    if (!authentication) throw new Error('OpenClasp OAuth token is invalid');
    assertScopes(authentication.scopes, requiredScopes);
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
    assertScopes(authentication.scopes, requiredScopes);
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
    requiredScopes,
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
});

async function handler(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    const rejected = await guardRequest(request, 'mcp', {
      limit: 300,
      maximumBytes: 256 * 1024,
    });
    if (rejected) return rejected;
  }
  const response = await authenticatedHandler(request);
  if (response.status >= 500) {
    console.error('[mcp.http] request failed', {
      status: response.status,
      method: request.method,
      protocolVersion: request.headers.get('mcp-protocol-version'),
      contentType: request.headers.get('content-type'),
      hasAuthorization: Boolean(request.headers.get('authorization')),
      response: (await response.clone().text()).slice(0, 1000),
    });
  }
  if (response.status !== 401 || request.headers.get('authorization')?.trim()) return response;

  // A missing credential is an authentication discovery challenge, not an invalid token.
  // Cursor's V2 MCP client treats `invalid_token` while auth is still unknown as a
  // transient connection failure instead of starting OAuth.
  const publicOrigin = new URL(request.url).origin;
  const headers = new Headers(response.headers);
  headers.set(
    'www-authenticate',
    `Bearer resource_metadata="${new URL(resourceMetadataPath, publicOrigin).href}", scope="${DEFAULT_MCP_AUTH_SCOPES.join(' ')}"`,
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
