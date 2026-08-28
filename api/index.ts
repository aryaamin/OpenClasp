import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClerkClient } from '@clerk/backend';
import { buildApi } from '../apps/api/src/app.js';
import { TrustEngine } from '../packages/core/src/index.js';
import { HostedRepository } from '../packages/persistence/src/hosted.js';

const databaseUrl = process.env.DATABASE_URL;
const repository = databaseUrl ? new HostedRepository(databaseUrl) : undefined;
const app = buildApi(new TrustEngine(), undefined, repository);
const ready = app.ready();

function clerkRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const host = request.headers.host ?? 'openclasp.vercel.app';
  return new Request(`https://${host}${request.url ?? '/'}`, { headers });
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const incoming = new URL(request.url ?? '/', 'https://openclasp.local');
  const target = incoming.searchParams.get('path');
  if (target) request.url = target;
  if ((request.url ?? '').startsWith('/v0.1/')) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!secretKey || !publishableKey || !request.headers.authorization) {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'authentication_required' }));
      return;
    }
    try {
      const origin = `https://${request.headers.host ?? 'openclasp.vercel.app'}`;
      const authentication = await createClerkClient({
        secretKey,
        publishableKey,
      }).authenticateRequest(clerkRequest(request), {
        acceptsToken: 'session_token',
        authorizedParties: [origin, 'https://openclasp.vercel.app'],
      });
      if (!authentication.isAuthenticated) throw new Error('Invalid session');
      const auth = authentication.toAuth();
      if (!auth.userId) throw new Error('Session has no subject');
      request.headers['x-openclasp-operator'] = auth.userId;
      const user = await createClerkClient({ secretKey, publishableKey }).users.getUser(
        auth.userId,
      );
      request.headers['x-openclasp-email'] = encodeURIComponent(
        user.primaryEmailAddress?.emailAddress ?? '',
      );
      request.headers['x-openclasp-name'] = encodeURIComponent(
        [user.firstName, user.lastName].filter(Boolean).join(' '),
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
