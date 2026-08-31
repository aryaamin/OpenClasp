import { neon } from '@neondatabase/serverless';
import { runHostedMigrations } from '../packages/persistence/src/hosted-migrations.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

await runHostedMigrations(neon(databaseUrl));

console.log('Hosted database migrations are current.');
