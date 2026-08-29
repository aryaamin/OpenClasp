import { auth0Config } from './auth0.js';

const maximumRegistrationBytes = 32_768;

export async function POST(request: Request): Promise<Response> {
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
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0)
    return Response.json(
      { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' },
      { status: 400 },
    );

  const { issuer } = auth0Config();
  const upstream = await fetch(`${issuer}oidc/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const responseBody = await upstream.text();
  if (!upstream.ok) {
    let reason = 'Auth0 rejected dynamic client registration';
    try {
      const error = JSON.parse(responseBody) as Record<string, unknown>;
      reason = String(error.error_description ?? error.message ?? error.error ?? reason);
    } catch {
      // Do not log an arbitrary upstream body.
    }
    console.warn('[oauth.dcr] registration rejected', {
      status: upstream.status,
      reason,
      redirectUriCount: metadata.redirect_uris.length,
    });
  } else {
    console.info('[oauth.dcr] registration accepted', {
      redirectUriCount: metadata.redirect_uris.length,
    });
  }

  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
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
