import { createHash } from 'node:crypto';
import { auth0Config } from './auth0.js';
import { oauthStore, randomOAuthValue, type OAuthStore } from './oauth-store.js';
import { DEFAULT_MCP_AUTH_SCOPES } from './access-control.js';
import { assertProductionConfiguration } from './production-config.js';

assertProductionConfiguration('auth');

const allowedScopes = new Set<string>(DEFAULT_MCP_AUTH_SCOPES);

function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status });
}

export async function authorize(request: Request, store: OAuthStore): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const codeChallenge = url.searchParams.get('code_challenge');
  const challengeMethod = url.searchParams.get('code_challenge_method');
  if (!clientId || !redirectUri)
    return oauthError('invalid_request', 'Missing client or redirect URI');
  const client = await store.getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri))
    return oauthError('invalid_request', 'Unknown client or redirect URI');
  if (responseType !== 'code') return oauthError('unsupported_response_type', 'Use code');
  if (!codeChallenge || challengeMethod !== 'S256')
    return oauthError('invalid_request', 'PKCE with S256 is required');

  const requestedScopes = (url.searchParams.get('scope') ?? DEFAULT_MCP_AUTH_SCOPES.join(' '))
    .split(/\s+/)
    .filter(Boolean);
  if (!requestedScopes.length || requestedScopes.some((scope) => !allowedScopes.has(scope)))
    return oauthError('invalid_scope', 'One or more requested OpenClasp scopes are unsupported');

  const transactionId = randomOAuthValue('oc_tx_');
  const auth0Verifier = randomOAuthValue('');
  const auth0Challenge = createHash('sha256').update(auth0Verifier).digest('base64url');
  await store.createTransaction({
    transactionId,
    clientId,
    redirectUri,
    ...(url.searchParams.has('state') ? { downstreamState: url.searchParams.get('state')! } : {}),
    scope: requestedScopes.join(' '),
    codeChallenge,
    auth0Verifier,
  });

  const config = auth0Config();
  const auth0Url = new URL(`${config.issuer}authorize`);
  auth0Url.search = new URLSearchParams({
    client_id: config.dashboardClientId,
    redirect_uri: `${config.publicOrigin}/sso-callback`,
    response_type: 'code',
    scope: 'openid profile email',
    audience: config.audience,
    state: transactionId,
    code_challenge: auth0Challenge,
    code_challenge_method: 'S256',
  }).toString();
  return Response.redirect(auth0Url, 302);
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await authorize(request, oauthStore());
  } catch {
    return oauthError('temporarily_unavailable', 'OAuth service unavailable', 503);
  }
}
