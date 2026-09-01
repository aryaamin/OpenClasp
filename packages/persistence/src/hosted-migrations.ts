import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

export const HOSTED_MIGRATIONS = [
  { version: 1, name: 'hosted_baseline' },
  { version: 2, name: 'append_only_source_records' },
  { version: 3, name: 'remove_hosted_conversations' },
  { version: 4, name: 'adaptive_assurance_probes' },
  { version: 5, name: 'assurance_decision_learning' },
  { version: 6, name: 'connector_claims' },
  { version: 7, name: 'provider_connections' },
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

async function removeHostedConversations(sql: Sql) {
  await sql`DROP TABLE IF EXISTS openclasp_hosted_messages`;
  await sql`DROP TABLE IF EXISTS openclasp_hosted_threads`;
}

async function addAdaptiveAssuranceProbes(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_ai_generations (
      generation_id UUID PRIMARY KEY,
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('pre_task', 'post_task')),
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'fallback', 'error')),
      input JSONB NOT NULL,
      input_digest TEXT NOT NULL,
      output JSONB,
      token_usage JSONB,
      error_code TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_ai_generations_interaction
    ON openclasp_ai_generations(operator_id, interaction_id, started_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_probe_plans (
      plan_id UUID PRIMARY KEY,
      generation_id UUID NOT NULL REFERENCES openclasp_ai_generations(generation_id),
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('pre_task', 'post_task')),
      generated_for_agent_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_probe_plans_interaction
    ON openclasp_assurance_probe_plans(interaction_id, phase, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_probe_responses (
      response_id UUID PRIMARY KEY,
      plan_id UUID NOT NULL REFERENCES openclasp_assurance_probe_plans(plan_id),
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('pre_task', 'post_task')),
      agent_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(plan_id, agent_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_probe_responses_interaction
    ON openclasp_assurance_probe_responses(interaction_id, agent_id, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_claim_comparisons (
      comparison_id UUID PRIMARY KEY,
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      pre_task_response_id UUID NOT NULL REFERENCES openclasp_assurance_probe_responses(response_id),
      post_task_response_id UUID REFERENCES openclasp_assurance_probe_responses(response_id),
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(operator_id, interaction_id, target_agent_id, pre_task_response_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_claim_comparisons_interaction
    ON openclasp_assurance_claim_comparisons(operator_id, interaction_id, created_at DESC)
  `;
}

async function addAssuranceDecisionLearning(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_assessments (
      assessment_id UUID PRIMARY KEY,
      generation_id UUID NOT NULL REFERENCES openclasp_ai_generations(generation_id),
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('pre_task', 'post_task')),
      round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
      target_agent_id TEXT NOT NULL,
      target_agent_version TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(operator_id, interaction_id, phase, round, target_agent_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_assessments_interaction
    ON openclasp_assurance_assessments(operator_id, interaction_id, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_predictions (
      prediction_id UUID PRIMARY KEY,
      assessment_id UUID REFERENCES openclasp_assurance_assessments(assessment_id),
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      target_agent_version TEXT NOT NULL,
      task_category TEXT NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('baseline', 'after_probe', 'after_safeguard', 'final')),
      success_probability DOUBLE PRECISION NOT NULL CHECK (success_probability BETWEEN 0.05 AND 0.95),
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_predictions_context
    ON openclasp_assurance_predictions(operator_id, target_agent_id, target_agent_version, task_category, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_safeguards (
      safeguard_id UUID PRIMARY KEY,
      assessment_id UUID NOT NULL REFERENCES openclasp_assurance_assessments(assessment_id),
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('recommended', 'accepted', 'rejected', 'modified')),
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_safeguards_interaction
    ON openclasp_assurance_safeguards(operator_id, interaction_id, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_assurance_evaluations (
      evaluation_id UUID PRIMARY KEY,
      operator_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      target_agent_version TEXT NOT NULL,
      task_category TEXT NOT NULL,
      completion_report_id UUID NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(operator_id, completion_report_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_assurance_evaluations_learning
    ON openclasp_assurance_evaluations(operator_id, target_agent_id, target_agent_version, task_category, created_at DESC)
  `;
}

async function addConnectorClaims(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_connector_claims (
      claim_id UUID PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      runtime_endpoint TEXT NOT NULL,
      credential_public_key TEXT NOT NULL,
      profile JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'connected', 'expired')),
      operator_id TEXT,
      agent_id TEXT,
      credential_ciphertext TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_connector_claims_expiry
    ON openclasp_connector_claims(status, expires_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_connector_claims_owner
    ON openclasp_connector_claims(operator_id, created_at DESC)
  `;
}

async function addProviderConnections(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS openclasp_provider_connections (
      connection_id UUID PRIMARY KEY,
      operator_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('botpress')),
      agent_name TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'connected', 'expired')),
      agent_id TEXT,
      runtime_endpoint TEXT,
      credential_public_key TEXT,
      credential_ciphertext TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      connected_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_provider_connections_owner
    ON openclasp_provider_connections(operator_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS openclasp_provider_connections_expiry
    ON openclasp_provider_connections(status, expires_at)
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
    if (migration.version === 3) await removeHostedConversations(sql);
    if (migration.version === 4) await addAdaptiveAssuranceProbes(sql);
    if (migration.version === 5) await addAssuranceDecisionLearning(sql);
    if (migration.version === 6) await addConnectorClaims(sql);
    if (migration.version === 7) await addProviderConnections(sql);
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
  const removedConversationTables = await sql`
    SELECT
      to_regclass('public.openclasp_hosted_messages') AS messages,
      to_regclass('public.openclasp_hosted_threads') AS threads
  `;
  if (removedConversationTables[0]?.messages || removedConversationTables[0]?.threads)
    throw new Error('Hosted conversation tables still exist; run `pnpm migrate`');
  const assuranceTables = await sql`
    SELECT
      to_regclass('public.openclasp_ai_generations') AS generations,
      to_regclass('public.openclasp_assurance_probe_plans') AS plans,
      to_regclass('public.openclasp_assurance_probe_responses') AS responses,
      to_regclass('public.openclasp_assurance_claim_comparisons') AS comparisons
  `;
  if (
    !assuranceTables[0]?.generations ||
    !assuranceTables[0]?.plans ||
    !assuranceTables[0]?.responses ||
    !assuranceTables[0]?.comparisons
  )
    throw new Error('Adaptive assurance probe tables are missing; run `pnpm migrate`');
  const decisionTables = await sql`
    SELECT
      to_regclass('public.openclasp_assurance_assessments') AS assessments,
      to_regclass('public.openclasp_assurance_predictions') AS predictions,
      to_regclass('public.openclasp_assurance_safeguards') AS safeguards,
      to_regclass('public.openclasp_assurance_evaluations') AS evaluations
  `;
  if (
    !decisionTables[0]?.assessments ||
    !decisionTables[0]?.predictions ||
    !decisionTables[0]?.safeguards ||
    !decisionTables[0]?.evaluations
  )
    throw new Error('Assurance decision learning tables are missing; run `pnpm migrate`');
  const connectorTables = await sql`
    SELECT to_regclass('public.openclasp_connector_claims') AS claims
  `;
  if (!connectorTables[0]?.claims)
    throw new Error('Connector claim table is missing; run `pnpm migrate`');
  const providerTables = await sql`
    SELECT to_regclass('public.openclasp_provider_connections') AS connections
  `;
  if (!providerTables[0]?.connections)
    throw new Error('Provider connection table is missing; run `pnpm migrate`');
}
