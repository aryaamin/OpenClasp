import {
  auth0Config,
  dashboardSessionCookie,
  dashboardTokenFromCookie,
  loadAuth0Profile,
  verifyAuth0Token,
} from './auth0.js';
import { guardRequest } from './request-security.js';
import { assertProductionConfiguration } from './production-config.js';

assertProductionConfiguration('auth');

function cookie(value: string, maxAge: number, secure: boolean) {
  return [
    `${dashboardSessionCookie}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export async function POST(request: Request): Promise<Response> {
  const rejected = await guardRequest(request, 'dashboard-session-create', {
    limit: 30,
    maximumBytes: 16_384,
  });
  if (rejected) return rejected;
  const input = (await request.json()) as { code?: unknown; codeVerifier?: unknown };
  if (typeof input.code !== 'string' || typeof input.codeVerifier !== 'string')
    return Response.json({ error: 'invalid_callback' }, { status: 400 });
  const config = auth0Config();
  const redirectUri = `${new URL(request.url).origin}/sso-callback`;
  const tokenResponse = await fetch(`${config.issuer}oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.dashboardClientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) return Response.json({ error: 'token_exchange_failed' }, { status: 401 });
  const tokens = (await tokenResponse.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof tokens.access_token !== 'string')
    return Response.json({ error: 'invalid_token_response' }, { status: 401 });
  const authentication = await verifyAuth0Token(tokens.access_token, { dashboard: true });
  const user = await loadAuth0Profile(tokens.access_token);
  const expiresIn =
    typeof tokens.expires_in === 'number'
      ? tokens.expires_in
      : typeof authentication.payload.exp === 'number'
        ? authentication.payload.exp - Math.floor(Date.now() / 1000)
        : 3600;
  return Response.json(
    { user: { ...user, sub: authentication.payload.sub } },
    {
      headers: {
        'cache-control': 'no-store',
        'set-cookie': cookie(
          tokens.access_token,
          Math.max(expiresIn - 30, 1),
          new URL(request.url).protocol === 'https:',
        ),
      },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const token = dashboardTokenFromCookie(request.headers.get('cookie') ?? undefined);
  if (!token) return Response.json({ authenticated: false }, { status: 401 });
  try {
    const authentication = await verifyAuth0Token(token, { dashboard: true });
    const user = await loadAuth0Profile(token);
    return Response.json(
      { authenticated: true, user: { ...user, sub: authentication.payload.sub } },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { authenticated: false },
      {
        status: 401,
        headers: {
          'cache-control': 'no-store',
          'set-cookie': cookie('', 0, new URL(request.url).protocol === 'https:'),
        },
      },
    );
  }
}

export function DELETE(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
      'set-cookie': cookie('', 0, new URL(request.url).protocol === 'https:'),
    },
  });
}
