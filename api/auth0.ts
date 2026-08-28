import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export const defaultAuth0Domain = 'icfg-0ua6bab8d4omtfolx72mrhzo.us.auth0.com';
export const defaultAuth0ClientId = 'vGxzZd4LiO7TqH4U61QblwH96YcimpcA';
export const defaultAudience = 'https://openclasp.vercel.app/mcp';

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function auth0Config() {
  const domain = (
    process.env.AUTH0_DOMAIN ??
    process.env.NEXT_PUBLIC_AUTH0_DOMAIN ??
    defaultAuth0Domain
  )
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return {
    domain,
    issuer: `https://${domain}/`,
    audience: process.env.AUTH0_AUDIENCE ?? process.env.OPENCLASP_MCP_URL ?? defaultAudience,
    dashboardClientId:
      process.env.AUTH0_CLIENT_ID ??
      process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ??
      defaultAuth0ClientId,
  };
}

function scopes(payload: JWTPayload): string[] {
  const scope = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((value): value is string => typeof value === 'string')
    : [];
  return [...new Set([...scope, ...permissions])];
}

export async function verifyAuth0Token(
  token: string,
  options: { dashboard?: boolean; requiredScopes?: string[] } = {},
) {
  const config = auth0Config();
  let remote = jwks.get(config.issuer);
  if (!remote) {
    remote = createRemoteJWKSet(new URL(`${config.issuer}.well-known/jwks.json`));
    jwks.set(config.issuer, remote);
  }
  const { payload } = await jwtVerify(token, remote, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ['RS256'],
  });
  if (!payload.sub) throw new Error('Access token has no subject');
  const clientId =
    typeof payload.client_id === 'string'
      ? payload.client_id
      : typeof payload.azp === 'string'
        ? payload.azp
        : undefined;
  if (!clientId) throw new Error('Access token has no client identifier');
  if (options.dashboard === true && clientId !== config.dashboardClientId)
    throw new Error('Agent token cannot access the dashboard API');
  if (options.dashboard === false && clientId === config.dashboardClientId)
    throw new Error('Dashboard token cannot access MCP');
  const grantedScopes = scopes(payload);
  if (options.requiredScopes?.some((scope) => !grantedScopes.includes(scope)))
    throw new Error('Access token is missing a required scope');
  return { payload, clientId, scopes: grantedScopes };
}

export async function loadAuth0Profile(token: string) {
  const { domain } = auth0Config();
  const response = await fetch(`https://${domain}/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return {};
  return (await response.json()) as { email?: string; name?: string };
}
