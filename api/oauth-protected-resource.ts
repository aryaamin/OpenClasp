import { auth0Config } from './auth0.js';

export function GET(request: Request): Response {
  const config = auth0Config();
  return Response.json({
    resource: process.env.OPENCLASP_MCP_URL ?? `${new URL(request.url).origin}/mcp`,
    authorization_servers: [config.issuer],
    scopes_supported: ['openid', 'profile', 'email', 'mcp:access'],
    bearer_methods_supported: ['header'],
  });
}
