import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApi } from '../apps/api/src/app.js';
import { TrustEngine } from '../packages/core/src/index.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';
import { dashboardTokenFromCookie, loadAuth0Profile, verifyAuth0Token } from './auth0.js';

const databaseUrl = process.env.DATABASE_URL;
const repository = databaseUrl ? new HostedRepository(databaseUrl) : undefined;
const app = buildApi(new TrustEngine(), undefined, repository);
const ready = app.ready();

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const incoming = new URL(request.url ?? '/', 'https://openclasp.local');
  const target = incoming.searchParams.get('path');
  if (target) request.url = target;
  if ((request.url ?? '').startsWith('/v0.1/')) {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : dashboardTokenFromCookie(request.headers.cookie);
    if (!token) {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'authentication_required' }));
      return;
    }
    try {
      const agentSelfService =
        /^\/v0\.1\/runtime(?:\/bootstrap|\/heartbeat)?(?:\?|$)/.test(request.url ?? '') ||
        /^\/v0\.1\/feedback-requests(?:\?|$)/.test(request.url ?? '') ||
        /^\/v0\.1\/federated-interactions\/[^/]+\/contract-proposals(?:\/[^/]+\/respond)?(?:\?|$)/.test(
          request.url ?? '',
        ) ||
        /^\/v0\.1\/federated-interactions\/[^/]+\/(?:brief|session|completion-reports|feedback)(?:\?|$)/.test(
          request.url ?? '',
        );
      if (token.startsWith('oc_at_') && agentSelfService) {
        if (!repository) throw new Error('Agent access tokens are not configured');
        const authentication = await repository.verifyAgentAccessToken(token);
        // Existing beta tokens had only mcp:access. They remain accepted because
        // they are already cryptographically bound to the same agent.
        if (
          !authentication.scopes.includes('runtime:connect') &&
          !authentication.scopes.includes('mcp:access')
        )
          throw new Error('Agent token cannot connect a runtime');
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
    } catch {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'invalid_session' }));
      return;
    }
  }
  await ready;
  app.server.emit('request', request, response);
}
