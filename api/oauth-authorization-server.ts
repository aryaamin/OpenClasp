import { auth0Config } from './auth0.js';

export async function GET(): Promise<Response> {
  const { issuer } = auth0Config();
  const response = await fetch(`${issuer}.well-known/oauth-authorization-server`);
  return new Response(response.body, {
    status: response.status,
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
      'content-type': 'application/json',
    },
  });
}
