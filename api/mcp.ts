import descopeSdk from '@descope/node-sdk';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { TrustEngine } from '../packages/core/src/index.js';
import { registerOpenClaspTools } from '../packages/mcp-server/src/server.js';

const engine = new TrustEngine();
const mcp = createMcpHandler((server) => registerOpenClaspTools(server, engine), {
  serverInfo: { name: 'openclasp', version: '0.1.0' },
  instructions:
    'OpenClasp provides identity, interaction assurance, private clues, receipts, and contextual behavioural history. Never submit raw private conversations.',
});

async function verifyToken(_request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const projectId = process.env.DESCOPE_PROJECT_ID ?? process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID;
  if (!projectId || !bearerToken) return undefined;
  const descope = descopeSdk({ projectId });
  const authentication = await descope.validateSession(bearerToken, {
    ...(process.env.OPENCLASP_MCP_URL ? { audience: process.env.OPENCLASP_MCP_URL } : {}),
  });
  if (!authentication.token.exp) return undefined;
  return {
    token: bearerToken,
    clientId: authentication.token.sub ?? 'unknown-client',
    scopes: descope.getJwtPermissions(bearerToken),
    expiresAt: authentication.token.exp,
  };
}

const handler = withMcpAuth(mcp, verifyToken, {
  required: true,
  requiredScopes: ['profile:read'],
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
  ...(process.env.OPENCLASP_MCP_URL
    ? { resourceUrl: new URL(process.env.OPENCLASP_MCP_URL).origin }
    : {}),
});

export { handler as GET, handler as POST };
