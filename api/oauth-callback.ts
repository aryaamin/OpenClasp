import { auth0Config, verifyAuth0Token } from './auth0.js';
import { oauthStore, type OAuthStore } from './oauth-store.js';

export async function callback(request: Request, store: OAuthStore): Promise<Response> {
  let input: { code?: unknown; state?: unknown };
  try {
    input = (await request.json()) as { code?: unknown; state?: unknown };
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (
    typeof input.code !== 'string' ||
    typeof input.state !== 'string' ||
    !input.state.startsWith('oc_tx_')
  )
    return Response.json({ error: 'invalid_request' }, { status: 400 });

  const transaction = await store.takeTransaction(input.state);
  if (!transaction) return Response.json({ error: 'invalid_transaction' }, { status: 400 });
  const config = auth0Config();
  const redirectUri = `${config.publicOrigin}/sso-callback`;
  const tokenResponse = await fetch(`${config.issuer}oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.dashboardClientId,
      code: input.code,
      code_verifier: transaction.auth0Verifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok)
    return Response.json({ error: 'identity_exchange_failed' }, { status: 401 });
  const tokens = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof tokens.access_token !== 'string')
    return Response.json({ error: 'invalid_identity_response' }, { status: 401 });
  const authentication = await verifyAuth0Token(tokens.access_token, { dashboard: true });
  const code = await store.createAuthorizationCode({
    clientId: transaction.clientId,
    operatorId: authentication.payload.sub!,
    redirectUri: transaction.redirectUri,
    scope: transaction.scope,
    codeChallenge: transaction.codeChallenge,
  });
  const downstream = new URL(transaction.redirectUri);
  downstream.searchParams.set('code', code);
  if (transaction.downstreamState)
    downstream.searchParams.set('state', transaction.downstreamState);
  return Response.json(
    { redirectTo: downstream.href },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await callback(request, oauthStore());
  } catch {
    return Response.json({ error: 'callback_failed' }, { status: 500 });
  }
}
