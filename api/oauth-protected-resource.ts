import { auth0Config } from './auth0.js';

export function GET(request: Request): Response {
  const config = auth0Config();
  return Response.json(
    {
      resource: process.env.OPENCLASP_MCP_URL ?? `${new URL(request.url).origin}/mcp`,
      authorization_servers: [config.issuer],
      scopes_supported: ['openid', 'profile', 'email', 'mcp:access'],
      bearer_methods_supported: ['header'],
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300',
      },
    },
  );
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-max-age': '86400',
    },
  });
}
