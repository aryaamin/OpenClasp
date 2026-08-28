import { protectedResourceHandler } from 'mcp-handler';

export function GET(request: Request): Response {
  const issuer = process.env.DESCOPE_MCP_ISSUER ?? process.env.DESCOPE_ISSUER;
  if (!issuer) return Response.json({ error: 'OAuth provider is not configured' }, { status: 503 });
  return protectedResourceHandler({
    authServerUrls: [issuer],
    ...(process.env.OPENCLASP_MCP_URL ? { resourceUrl: process.env.OPENCLASP_MCP_URL } : {}),
  })(request);
}
