import { neon } from '@neondatabase/serverless';
import {
  runHostedMigrations,
  verifyHostedMigrations,
} from '../packages/persistence/src/hosted-migrations.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = neon(databaseUrl);
await runHostedMigrations(sql);
await verifyHostedMigrations(sql);

console.log('Hosted database migrations are current.');
