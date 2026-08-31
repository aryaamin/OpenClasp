import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

export const HOSTED_MIGRATIONS = [
  { version: 1, name: 'hosted_baseline' },
  { version: 2, name: 'append_only_source_records' },
] as const;

async function applyBaseline(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_records (
      operator_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (operator_id, kind, record_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_records_operator_created
    ON openclasp_records(operator_id, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_account_settings (
      operator_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      contribution_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 0 AND 3650),
      evidence_sharing TEXT NOT NULL DEFAULT 'ask'
        CHECK (evidence_sharing IN ('never', 'ask', 'contract_only')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_public_agents (
      agent_id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      card JSONB NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_public_agents_updated
    ON openclasp_public_agents(updated_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_federated_interactions (
      interaction_id TEXT PRIMARY KEY,
      initiator_operator_id TEXT NOT NULL,
      responder_operator_id TEXT NOT NULL,
      initiator_agent_id TEXT NOT NULL,
      responder_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_federated_interactions_participants
    ON openclasp_federated_interactions(
      initiator_operator_id,
      responder_operator_id,
      updated_at DESC
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_agent_runtimes (
      agent_id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      secret_ciphertext TEXT NOT NULL,
      secret_iv TEXT NOT NULL,
      secret_auth_tag TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('verified', 'disabled')),
      verified_at TIMESTAMPTZ NOT NULL,
      last_delivery_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_agent_access_tokens (
      token_id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      scopes JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_agent_access_tokens_owner_agent
    ON openclasp_agent_access_tokens(operator_id, agent_id, created_at DESC)
  `;
  await sql`
    ALTER TABLE openclasp_agent_runtimes
    ADD COLUMN IF NOT EXISTS a2a_endpoint TEXT,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_live_sessions (
      interaction_id TEXT PRIMARY KEY,
      initiator_agent_id TEXT NOT NULL,
      responder_agent_id TEXT NOT NULL,
      initiator_session_id TEXT NOT NULL,
      responder_session_id TEXT NOT NULL,
      initiator_endpoint TEXT NOT NULL,
      responder_endpoint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('preparing', 'active', 'completed', 'failed')),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_error TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_live_session_events (
      interaction_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (interaction_id, event_id),
      UNIQUE (interaction_id, agent_id, sequence)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_hosted_threads (
      thread_id TEXT PRIMARY KEY,
      interaction_id TEXT NOT NULL UNIQUE,
      participant_a_agent_id TEXT NOT NULL,
      participant_b_agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_hosted_threads_participants
    ON openclasp_hosted_threads(
      participant_a_agent_id,
      participant_b_agent_id,
      updated_at DESC
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_hosted_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES openclasp_hosted_threads(thread_id) ON DELETE CASCADE,
      interaction_id TEXT NOT NULL,
      sender_agent_id TEXT NOT NULL,
      recipient_agent_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      content_ciphertext TEXT NOT NULL,
      content_iv TEXT NOT NULL,
      content_auth_tag TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      delivery TEXT NOT NULL CHECK (delivery IN ('accepted', 'delivered', 'read')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS openclasp_hosted_messages_dedup
    ON openclasp_hosted_messages(thread_id, sender_agent_id, request_key)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_hosted_messages_thread_created
    ON openclasp_hosted_messages(thread_id, created_at ASC)
  `;
}

async function applyAppendOnlySourceRecords(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_source_records (
      event_id UUID PRIMARY KEY,
      operator_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      payload JSONB NOT NULL,
      payload_digest TEXT NOT NULL,
      entity_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
      provenance TEXT NOT NULL,
      visibility TEXT NOT NULL,
      retention_class TEXT NOT NULL,
      learning_scope TEXT NOT NULL,
      reported_at TIMESTAMPTZ NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL,
      UNIQUE (operator_id, kind, record_id, payload_digest),
      CHECK (provenance IN (
        'self_declared',
        'operator_attested',
        'cryptographically_verified',
        'domain_verified',
        'third_party_verified',
        'observed',
        'disputed'
      )),
      CHECK (visibility IN (
        'local_only',
        'private_requester',
        'private_responder',
        'shared_participants',
        'network_aggregate'
      )),
      CHECK (retention_class IN ('account', 'audit', 'operational', 'temporary')),
      CHECK (learning_scope IN (
        'not_evaluated',
        'excluded',
        'local_only',
        'network_aggregate'
      ))
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_source_records_operator_ingested
    ON openclasp_source_records(operator_id, ingested_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_source_records_history
    ON openclasp_source_records(operator_id, kind, record_id, ingested_at ASC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_source_records_entities
    ON openclasp_source_records USING GIN(entity_refs)
  `;
}

export async function runHostedMigrations(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  const appliedRows = await sql`
    SELECT version, name FROM openclasp_schema_migrations ORDER BY version ASC
  `;
  const applied = new Map(appliedRows.map((row) => [Number(row.version), String(row.name)]));
  for (const migration of HOSTED_MIGRATIONS) {
    const appliedName = applied.get(migration.version);
    if (appliedName && appliedName !== migration.name)
      throw new Error(
        `Hosted migration ${migration.version} name mismatch: ${appliedName} != ${migration.name}`,
      );
    if (appliedName) continue;
    if (migration.version === 1) await applyBaseline(sql);
    if (migration.version === 2) await applyAppendOnlySourceRecords(sql);
    await sql`
      INSERT INTO openclasp_schema_migrations(version, name)
      VALUES (${migration.version}, ${migration.name})
      ON CONFLICT (version) DO NOTHING
    `;
  }
}

export async function verifyHostedMigrations(sql: Sql): Promise<void> {
  const tableRows = await sql`
    SELECT to_regclass('public.openclasp_schema_migrations') AS table_name
  `;
  if (!tableRows[0]?.table_name)
    throw new Error('Hosted database is not migrated; run `pnpm migrate` before starting the API');
  const appliedRows = await sql`
    SELECT version, name FROM openclasp_schema_migrations ORDER BY version ASC
  `;
  const applied = new Map(appliedRows.map((row) => [Number(row.version), String(row.name)]));
  for (const migration of HOSTED_MIGRATIONS) {
    const name = applied.get(migration.version);
    if (name !== migration.name)
      throw new Error(
        `Hosted database migration ${migration.version} is missing or invalid; run \`pnpm migrate\``,
      );
  }
}
