import type { IncomingMessage, ServerResponse } from 'node:http';
import { HostedRepository } from '../packages/persistence/src/hosted.js';

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'cron_not_configured' }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${secret}`) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'database_not_configured' }));
    return;
  }
  const result = await new HostedRepository(databaseUrl).processDueFeedback();
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true, ...result }));
}
