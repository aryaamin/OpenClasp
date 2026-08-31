import { oauthStore, type OAuthStore } from '../apps/api/src/oauth-store.js';
import { guardRequest } from '../apps/api/src/request-security.js';
import { assertProductionConfiguration } from '../apps/api/src/production-config.js';

assertProductionConfiguration('auth');

const maximumRegistrationBytes = 32_768;

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    return !['javascript:', 'data:', 'file:', 'vbscript:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function register(request: Request, store: OAuthStore): Promise<Response> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumRegistrationBytes)
    return Response.json({ error: 'invalid_client_metadata' }, { status: 413 });

  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    metadata = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  const redirectUris = metadata.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    !redirectUris.every(validRedirectUri)
  )
    return Response.json(
      { error: 'invalid_redirect_uri', error_description: 'Valid redirect_uris are required' },
      { status: 400 },
    );
  if (
    metadata.token_endpoint_auth_method !== undefined &&
    metadata.token_endpoint_auth_method !== 'none'
  )
    return Response.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'Only public PKCE clients are supported',
      },
      { status: 400 },
    );

  const client = await store.registerClient({
    ...metadata,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  console.info('[oauth.dcr] OpenClasp client registered', {
    clientId: client.clientId,
    redirectUriCount: client.redirectUris.length,
  });
  return Response.json(
    {
      ...metadata,
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    {
      status: 201,
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  const rejected = await guardRequest(request, 'oauth-register', {
    limit: 20,
    maximumBytes: maximumRegistrationBytes,
  });
  if (rejected) return rejected;
  try {
    return await register(request, oauthStore());
  } catch {
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
  }
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-max-age': '86400',
    },
  });
}
