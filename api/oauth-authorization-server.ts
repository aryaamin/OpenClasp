import { auth0Config } from './auth0.js';

export async function GET(request: Request): Promise<Response> {
  const { audience, issuer } = auth0Config();
  const response = await fetch(`${issuer}.well-known/oauth-authorization-server`);
  if (!response.ok)
    return Response.json({ error: 'authorization_server_metadata_unavailable' }, { status: 502 });

  const metadata = (await response.json()) as Record<string, unknown>;
  const origin = new URL(request.url).origin;
  const authorizationEndpoint = new URL(String(metadata.authorization_endpoint));
  authorizationEndpoint.searchParams.set('audience', audience);
  return Response.json(
    {
      ...metadata,
      issuer: origin,
      authorization_endpoint: authorizationEndpoint.href,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: ['mcp:access'],
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
      'access-control-allow-headers': 'content-type, mcp-protocol-version',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-max-age': '86400',
    },
  });
}
