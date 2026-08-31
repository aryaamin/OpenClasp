import { createHash, timingSafeEqual } from 'node:crypto';
import { oauthStore, type OAuthStore } from './oauth-store.js';
import { guardRequest } from './request-security.js';
import { assertProductionConfiguration } from './production-config.js';

assertProductionConfiguration('auth');

const noStoreHeaders = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  pragma: 'no-cache',
};

function tokenError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: noStoreHeaders },
  );
}

function matchesChallenge(verifier: string, expected: string): boolean {
  const actual = createHash('sha256').update(verifier).digest('base64url');
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function exchange(request: Request, store: OAuthStore): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get('grant_type');
  const clientId = form.get('client_id');
  if (!clientId) return tokenError('invalid_client', 'client_id is required', 401);

  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const verifier = form.get('code_verifier');
    if (!code || !redirectUri || !verifier)
      return tokenError('invalid_request', 'Code, redirect URI, and PKCE verifier are required');
    const authorization = await store.takeAuthorizationCode(code);
    if (
      !authorization ||
      authorization.clientId !== clientId ||
      authorization.redirectUri !== redirectUri ||
      !matchesChallenge(verifier, authorization.codeChallenge)
    )
      return tokenError('invalid_grant', 'Authorization code is invalid or expired');
    const scopes = authorization.scope.split(/\s+/).filter(Boolean);
    const issued = await store.issueTokens(clientId, authorization.operatorId, scopes);
    return Response.json(
      {
        access_token: issued.accessToken,
        token_type: 'Bearer',
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: scopes.join(' '),
      },
      { headers: noStoreHeaders },
    );
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    if (!refreshToken) return tokenError('invalid_request', 'refresh_token is required');
    const issued = await store.rotateRefreshToken(refreshToken, clientId);
    if (!issued) return tokenError('invalid_grant', 'Refresh token is invalid or expired');
    return Response.json(
      {
        access_token: issued.accessToken,
        token_type: 'Bearer',
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: issued.scopes.join(' '),
      },
      { headers: noStoreHeaders },
    );
  }

  return tokenError('unsupported_grant_type', 'Unsupported grant type');
}

export async function POST(request: Request): Promise<Response> {
  const rejected = await guardRequest(request, 'oauth-token', {
    limit: 60,
    maximumBytes: 16_384,
  });
  if (rejected) return rejected;
  try {
    return await exchange(request, oauthStore());
  } catch {
    return tokenError('temporarily_unavailable', 'OAuth service unavailable', 503);
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
