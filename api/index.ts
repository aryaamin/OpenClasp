import type { IncomingMessage, ServerResponse } from 'node:http';
import descopeSdk from '@descope/node-sdk';
import { buildApi } from '../apps/api/src/app.js';
import { TrustEngine } from '../packages/core/src/index.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';

const databaseUrl = process.env.DATABASE_URL;
const repository = databaseUrl ? new HostedRepository(databaseUrl) : undefined;
const app = buildApi(new TrustEngine(), undefined, repository);
const ready = app.ready();

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const incoming = new URL(request.url ?? '/', 'https://openclasp.local');
  const target = incoming.searchParams.get('path');
  if (target) request.url = target;
  if ((request.url ?? '').startsWith('/v0.1/')) {
    const projectId = process.env.DESCOPE_PROJECT_ID ?? process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID;
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!projectId || !token) {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'authentication_required' }));
      return;
    }
    try {
      const authentication = await descopeSdk({ projectId }).validateSession(token, {
        audience: projectId,
      });
      const operatorId = authentication.token.sub;
      if (!operatorId) throw new Error('Session has no subject');
      request.headers['x-openclasp-operator'] = operatorId;
      request.headers['x-openclasp-email'] = encodeURIComponent(
        String(authentication.token.email ?? ''),
      );
      request.headers['x-openclasp-name'] = encodeURIComponent(
        String(authentication.token.name ?? ''),
      );
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
