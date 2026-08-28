import { buildApi } from './app.js';
import { TrustEngine } from '../../../packages/core/src/index.js';
import { SqliteAuditStore } from '../../../packages/persistence/src/index.js';

const engine = new TrustEngine(new SqliteAuditStore(process.env.OPENCLASP_DB ?? 'openclasp.db'));
await buildApi(engine).listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3100),
});
