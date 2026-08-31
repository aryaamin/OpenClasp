import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildApi } from '../apps/api/src/app.js';
import { TrustEngine } from '../packages/core/src/index.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';
import {
  dashboardTokenFromCookie,
  loadAuth0Profile,
  verifyAuth0Token,
} from '../apps/api/src/auth0.js';
import {
  ScopeError,
  assertScopes,
  requiredAgentApiScopes,
} from '../apps/api/src/access-control.js';
import { assertProductionConfiguration } from '../apps/api/src/production-config.js';

assertProductionConfiguration('api');

const databaseUrl = process.env.DATABASE_URL;
const repository = databaseUrl ? new HostedRepository(databaseUrl) : undefined;
const internalAuthSecret = randomBytes(32).toString('base64url');
const app = buildApi(new TrustEngine(), undefined, repository, { internalAuthSecret });
const ready = app.ready();

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function reject(response: ServerResponse, statusCode: number, error: string) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({ error }));
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  delete request.headers['x-openclasp-operator'];
  delete request.headers['x-openclasp-bound-agent'];
  delete request.headers['x-openclasp-credential-type'];
  delete request.headers['x-openclasp-internal-auth'];
  const incoming = new URL(request.url ?? '/', 'https://openclasp.local');
  const target = incoming.searchParams.get('path');
  if (target) request.url = target;
  if ((request.url ?? '').startsWith('/v0.1/')) {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const dashboardToken = bearerToken
      ? undefined
      : dashboardTokenFromCookie(request.headers.cookie);
    const token = bearerToken ?? dashboardToken;
    if (!token) {
      reject(response, 401, 'authentication_required');
      return;
    }
    try {
      if (dashboardToken && unsafeMethods.has(request.method ?? 'GET')) {
        const origin = request.headers.origin;
        const forwardedProtocol = request.headers['x-forwarded-proto'];
        const forwardedHost = request.headers['x-forwarded-host'];
        const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol : 'https';
        const host = typeof forwardedHost === 'string' ? forwardedHost : request.headers.host;
        const expectedOrigin = `${protocol}://${host}`;
        if (origin !== expectedOrigin) {
          reject(response, 403, 'invalid_request_origin');
          return;
        }
      }
      if (token.startsWith('oc_at_')) {
        if (!repository) throw new Error('Agent access tokens are not configured');
        const requiredScopes = requiredAgentApiScopes(request.method ?? 'GET', request.url ?? '/');
        if (!requiredScopes) {
          reject(response, 403, 'agent_route_forbidden');
          return;
        }
        const authentication = await repository.verifyAgentAccessToken(token);
        assertScopes(authentication.scopes, requiredScopes);
        request.headers['x-openclasp-operator'] = authentication.operatorId;
        request.headers['x-openclasp-bound-agent'] = authentication.agentId;
        request.headers['x-openclasp-credential-type'] = 'agent_access_token';
      } else {
        const authentication = await verifyAuth0Token(token, { dashboard: true });
        request.headers['x-openclasp-operator'] = authentication.payload.sub!;
        if ((request.url ?? '').startsWith('/v0.1/account')) {
          const user = await loadAuth0Profile(token);
          request.headers['x-openclasp-email'] = encodeURIComponent(user.email ?? '');
          request.headers['x-openclasp-name'] = encodeURIComponent(user.name ?? '');
        }
      }
      request.headers['x-openclasp-internal-auth'] = internalAuthSecret;
    } catch (error) {
      reject(
        response,
        error instanceof ScopeError ? 403 : 401,
        error instanceof ScopeError ? 'insufficient_scope' : 'invalid_session',
      );
      return;
    }
  }
  await ready;
  app.server.emit('request', request, response);
}
