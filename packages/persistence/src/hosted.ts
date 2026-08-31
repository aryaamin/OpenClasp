import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';
import {
  buildCounterpartyBrief,
  buildInteractionConclusion,
  deriveBehaviouralObservations,
  evaluateLearningEligibility,
  summarizeContextualReliability,
  updateContextualBehaviouralProfile,
} from '../../core/src/index.js';
import {
  AgentIdentitySchema,
  AgentResolutionSchema,
  BehaviouralProfileDeltaSchema,
  DEFAULT_AGENT_AUTH_SCOPES,
  DEFAULT_EXTENSION_URI,
  CounterpartyBriefSchema,
  ContractRevisionSchema,
  FederatedInteractionSchema,
  FeedbackDimensionSchema,
  FeedbackRequestSchema,
  LiveSessionAcceptanceSchema,
  LiveSessionActivationSchema,
  LiveSessionEventSchema,
  LiveSessionOfferSchema,
  LiveSessionStateRecordSchema,
  HostedMessageSchema,
  HostedThreadSchema,
  InteractionCompletionReportSchema,
  InteractionContractSchema,
  InteractionConclusionSchema,
  InteractionFeedbackSchema,
  LearningEligibilityDecisionSchema,
  PublicAgentCardSchema,
  ReceiptSchema,
  canonicalHash,
  verifyObject,
  type FederatedInteraction,
  type AgentPresence,
  type AgentResolution,
  type BehaviouralProfileDelta,
  type CounterpartyBrief,
  type ContractRevision,
  type LiveSessionActivation,
  type LiveSessionEvent,
  type LiveSessionInsight,
  type HostedMessage,
  type HostedThread,
  type InteractionCompletionReport,
  type InteractionContract,
  type InteractionFeedback,
  type InteractionConclusion,
  type PublicAgentCard,
} from '../../protocol/src/index.js';
import type { AgentProfile } from './onboarding.js';
import type { AgentInstallation } from './onboarding.js';
import {
  agentAccessTokenClientId,
  agentAccessTokenId,
  createAgentAccessToken,
  matchesAgentAccessToken,
  type AgentAccessTokenMetadata,
} from './access-token.js';
import {
  decryptGatewayPayload,
  encryptGatewayPayload,
  attestSessionRecord,
  getSessionKeyId,
  getSessionVerificationKey,
  issueSessionGrant,
  signSessionControl,
  verifySessionGrant,
} from './relay.js';
import { postRuntimeJson, resolvePublicRuntimeEndpoint } from './runtime.js';
import { verifyHostedMigrations } from './hosted-migrations.js';
import {
  buildSourceRecordEnvelope,
  shouldJournalSourceRecord,
  type SourceRecordWriteMetadata,
} from './source-record.js';

export type HostedRecordKind =
  | 'agent'
  | 'delegation'
  | 'contract'
  | 'interaction'
  | 'event'
  | 'receipt'
  | 'feedback'
  | 'counterparty_brief'
  | 'completion_report'
  | 'feedback_request'
  | 'interaction_feedback'
  | 'interaction_conclusion'
  | 'learning_eligibility'
  | 'profile_delta'
  | 'conflict'
  | 'profile'
  | 'consent'
  | 'revocation'
  | 'project'
  | 'agent_profile'
  | 'installation'
  | 'setup_request'
  | 'publication'
  | 'presence';

export type { PublicAgentCard, FederatedInteraction } from '../../protocol/src/index.js';

type ContextualProfile = {
  recordId: string;
  agentId: string;
  agentVersion: string;
  taskCategory: string;
  sampleSize: number;
  effectiveSampleSize?: number;
  dimensionSampleSizes?: Partial<
    Record<
      | 'completion'
      | 'acceptance'
      | 'specification'
      | 'deadline'
      | 'communication'
      | 'evidence'
      | 'scope'
      | 'correction'
      | 'limitations'
      | 'disputes',
      number
    >
  >;
  updatedAt: string;
  completion: number;
  acceptance: number;
  specification: number;
  deadline: number;
  communication: number;
  evidence: number;
  scope: number;
  correction: number;
  limitations: number;
  disputes: number;
};

const FEEDBACK_DIMENSIONS = FeedbackDimensionSchema.options;

function feedbackWindowMilliseconds() {
  const configured = Number(process.env.OPENCLASP_FEEDBACK_WINDOW_MINUTES ?? 120);
  const minutes = Number.isFinite(configured) ? Math.max(15, Math.min(1440, configured)) : 120;
  return minutes * 60_000;
}

function reviewerCredibility(feedback: InteractionFeedback): number {
  const provenance =
    feedback.submissionMethod === 'agent_signature'
      ? 0.9
      : feedback.submissionMethod === 'runtime_session'
        ? 0.8
        : feedback.submissionMethod === 'agent_access_token'
          ? 0.75
          : 0.65;
  return Math.min(1, provenance + (feedback.evidenceReferences.length ? 0.1 : 0));
}

function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizePublicAgentCard(value: unknown): PublicAgentCard {
  const current = PublicAgentCardSchema.safeParse(value);
  const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
    /\/$/,
    '',
  );
  if (current.success) {
    const slug = current.data.slug ?? publicAgentSlug(current.data.name, current.data.agentId);
    return PublicAgentCardSchema.parse({
      ...current.data,
      slug,
      profileUrl: `${baseUrl}/a/${encodeURIComponent(slug)}`,
      cardUrl: `${baseUrl}/agents/${encodeURIComponent(current.data.agentId)}/card.json`,
      a2aAgentCardUrl: `${baseUrl}/agents/${encodeURIComponent(current.data.agentId)}/a2a-agent-card.json`,
      extensionUri: current.data.extensionUri ?? DEFAULT_EXTENSION_URI,
      verification: {
        ...(current.data.verification ?? {
          status: 'verified',
          method: 'openclasp_oauth_account',
          verifiedAt: current.data.publishedAt,
        }),
        verificationKeyUrl: `${baseUrl}/.well-known/openclasp-session-key`,
      },
    });
  }
  const legacy = value as Record<string, unknown>;
  const agentId = String(legacy.agentId ?? '');
  const slug = publicAgentSlug(String(legacy.name ?? agentId), agentId);
  return PublicAgentCardSchema.parse({
    protocolVersion: '0.1',
    agentId,
    name: legacy.name,
    description: '',
    framework: legacy.framework,
    agentVersion: '1.0.0',
    capabilities: legacy.capabilities,
    limitations: legacy.limitations,
    assurance: legacy.assurance,
    transports:
      typeof legacy.a2aEndpoint === 'string'
        ? [
            {
              protocol: 'A2A/1.0',
              protocolBinding: 'JSONRPC',
              endpoint: legacy.a2aEndpoint,
              managedBy: 'agent',
            },
          ]
        : [],
    slug,
    profileUrl: `${baseUrl}/a/${encodeURIComponent(slug)}`,
    cardUrl: `${baseUrl}/agents/${encodeURIComponent(agentId)}/card.json`,
    a2aAgentCardUrl: `${baseUrl}/agents/${encodeURIComponent(agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
    verification: {
      status: 'verified',
      method: 'openclasp_oauth_account',
      verifiedAt: legacy.publishedAt,
      verificationKeyUrl: `${baseUrl}/.well-known/openclasp-session-key`,
    },
    publishedAt: legacy.publishedAt,
    updatedAt: legacy.updatedAt,
  });
}

function publicAgentSlug(name: string, agentId: string) {
  const prefix =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'agent';
  const suffix = createHash('sha256').update(agentId).digest('hex').slice(0, 8);
  return `${prefix}-${suffix}`;
}

export function buildPublicAgentCard(
  agent: AgentProfile,
  baseUrl: string,
  previous?: PublicAgentCard,
): PublicAgentCard {
  const now = new Date().toISOString();
  const root = baseUrl.replace(/\/$/, '');
  const slug = previous?.slug ?? publicAgentSlug(agent.name, agent.agentId);
  return PublicAgentCardSchema.parse({
    protocolVersion: '0.1',
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description ?? '',
    framework: agent.framework,
    agentVersion: agent.agentVersion ?? '1.0.0',
    capabilities: agent.capabilities,
    limitations: agent.limitations,
    assurance: 'oauth_authenticated',
    agentMode: agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat'),
    transports:
      (agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat')) ===
      'temporary_chat'
        ? [
            {
              protocol: 'A2A/1.0',
              protocolBinding: 'JSONRPC',
              endpoint: `${root}/a2a/temporary/${encodeURIComponent(agent.agentId)}`,
              managedBy: 'openclasp',
            },
          ]
        : agent.a2aEndpoint
          ? [
              {
                protocol: 'A2A/1.0',
                protocolBinding: 'JSONRPC',
                endpoint: agent.a2aEndpoint,
                managedBy: 'agent',
              },
            ]
          : [],
    slug,
    profileUrl: `${root}/a/${encodeURIComponent(slug)}`,
    cardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/card.json`,
    a2aAgentCardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
    verification: {
      status: 'verified',
      method: 'openclasp_oauth_account',
      verifiedAt: previous?.verification?.verifiedAt ?? previous?.publishedAt ?? now,
      verificationKeyUrl: `${root}/.well-known/openclasp-session-key`,
    },
    publishedAt: previous?.publishedAt ?? now,
    updatedAt: now,
  });
}

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

export const AGENT_ONLINE_WINDOW_MS = 2 * 60_000;

export function resolveAgentPresence(lastSeenAt?: string, now = new Date()): AgentPresence {
  const online = Boolean(
    lastSeenAt && now.getTime() - Date.parse(lastSeenAt) <= AGENT_ONLINE_WINDOW_MS,
  );
  return {
    status: online ? 'online' : 'offline',
    ...(lastSeenAt ? { lastSeenAt } : {}),
    checkedAt: now.toISOString(),
  };
}

export function canAutoAcceptInteraction(
  agent: AgentProfile,
  interaction: FederatedInteraction,
): boolean {
  if (agent.autoAcceptPolicy !== 'safe_matching' || agent.status !== 'active') return false;
  const categories = new Set(
    [...(agent.autoAcceptTaskCategories ?? []), ...(agent.capabilities ?? [])].map(normalized),
  );
  const taskCategory = normalized(interaction.contract.taskCategory);
  if (!taskCategory || !categories.has(taskCategory)) return false;
  if (interaction.contract.allowedData.length > 0) return false;
  if (
    /\b(password|secret|api[_ -]?key|access[_ -]?token|credential|bank|payment|medical|health|ssn|personal[_ -]?data|customer[_ -]?record)\b/i.test(
      `${interaction.contract.purpose} ${interaction.contract.requestedOutcome}`,
    )
  )
    return false;
  if (interaction.contract.humanApprovalRequirements.length > 0) return false;
  if (interaction.contract.retentionDays > 30) return false;
  if (interaction.contract.allowedActions.length > 0) {
    const capabilities = new Set((agent.capabilities ?? []).map(normalized));
    if (
      !interaction.contract.allowedActions.every((action) => capabilities.has(normalized(action)))
    )
      return false;
  }
  return true;
}

function withContractRevisionHistory(value: FederatedInteraction): FederatedInteraction {
  if (value.contractRevisions.length) return value;
  const status =
    value.status === 'pending'
      ? 'proposed'
      : ['active', 'completed'].includes(value.status)
        ? 'accepted'
        : 'rejected';
  const revision = ContractRevisionSchema.parse({
    revisionId: deterministicUuid(`${value.interactionId}:contract:1:${value.termsHash}`),
    interactionId: value.interactionId,
    revision: value.contractRevision,
    termsHash: value.termsHash,
    contract: value.contract,
    proposedByAgentId: value.initiatorAgentId,
    status,
    acceptances: value.acceptances,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
  });
  return FederatedInteractionSchema.parse({ ...value, contractRevisions: [revision] });
}

function openContractRevision(value: FederatedInteraction): ContractRevision | undefined {
  return [...value.contractRevisions].reverse().find((revision) => revision.status === 'proposed');
}

export type AccountSettings = {
  displayName: string;
  contributionEnabled: boolean;
  retentionDays: number;
  evidenceSharing: 'never' | 'ask' | 'contract_only';
  rawConversationsStored: false;
};

const defaults: AccountSettings = {
  displayName: '',
  contributionEnabled: false,
  retentionDays: 30,
  evidenceSharing: 'ask',
  rawConversationsStored: false,
};

export class HostedRepository {
  private readonly sql: NeonQueryFunction<false, false>;
  private initialized?: Promise<void>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private gatewaySecret() {
    const value = process.env.OPENCLASP_RELAY_ENCRYPTION_KEY;
    if (!value || value.length < 32) throw new Error('Gateway encryption is not configured');
    return value;
  }

  private gatewaySecrets() {
    const active = this.gatewaySecret();
    const previous = (process.env.OPENCLASP_RELAY_PREVIOUS_KEYS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (previous.some((value) => value.length < 32))
      throw new Error('A previous gateway key is too short');
    if (previous.length > 3) throw new Error('At most three previous gateway keys are supported');
    return [...new Set([active, ...previous])];
  }

  private decryptGatewayPayload(encrypted: { ciphertext: string; iv: string; authTag: string }) {
    for (const secret of this.gatewaySecrets()) {
      try {
        return decryptGatewayPayload(secret, encrypted);
      } catch {
        // Try retained rotation keys without exposing which key failed.
      }
    }
    throw new Error('Encrypted gateway payload could not be decrypted');
  }

  private verifySessionGrant(token: string) {
    for (const secret of this.gatewaySecrets()) {
      try {
        return verifySessionGrant(secret, token);
      } catch {
        // Short-lived sessions remain valid during an orderly key rotation.
      }
    }
    throw new Error('Invalid or expired live-session credential');
  }

  private attestPublicAgentCard(value: PublicAgentCard): PublicAgentCard {
    const unsigned = { ...value };
    delete unsigned.platformAttestation;
    return PublicAgentCardSchema.parse({
      ...unsigned,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), unsigned),
    });
  }

  ensureSchema(): Promise<void> {
    return (this.initialized ??= verifyHostedMigrations(this.sql));
  }

  private async appendSourceRecord(
    operatorId: string,
    kind: string,
    recordId: string,
    payload: unknown,
    metadata?: SourceRecordWriteMetadata,
  ) {
    const source = buildSourceRecordEnvelope({
      operatorId,
      kind,
      recordId,
      payload,
      ...(metadata ? { metadata } : {}),
    });
    await this.sql`
      INSERT INTO openclasp_source_records(
        event_id, operator_id, kind, record_id, schema_name, schema_version, payload,
        payload_digest, entity_refs, provenance, visibility, retention_class, learning_scope,
        reported_at, ingested_at
      ) VALUES (
        ${source.eventId}, ${source.operatorId}, ${source.kind}, ${source.recordId},
        ${source.schemaName}, ${source.schemaVersion}, ${JSON.stringify(source.payload)}::jsonb,
        ${source.payloadDigest}, ${JSON.stringify(source.entityRefs)}::jsonb,
        ${source.provenance}, ${source.visibility}, ${source.retentionClass},
        ${source.learningScope}, ${source.reportedAt}, ${source.ingestedAt}
      )
      ON CONFLICT (operator_id, kind, record_id, payload_digest) DO NOTHING
    `;
  }

  private async interactionOperatorIds(interactionId: string): Promise<string[]> {
    const rows = await this.sql`
      SELECT initiator_operator_id, responder_operator_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
      LIMIT 1
    `;
    if (!rows[0]) return [];
    return [
      ...new Set([String(rows[0].initiator_operator_id), String(rows[0].responder_operator_id)]),
    ];
  }

  private async journalFederatedInteraction(interactionId: string) {
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
      LIMIT 1
    `;
    if (!rows[0]) return;
    const payload = FederatedInteractionSchema.parse(rows[0].payload);
    const operatorIds = [
      ...new Set([String(rows[0].initiator_operator_id), String(rows[0].responder_operator_id)]),
    ];
    await Promise.all(
      operatorIds.map((operatorId) =>
        this.appendSourceRecord(operatorId, 'federated_interaction', interactionId, payload, {
          schemaName: 'openclasp.federated_interaction',
          schemaVersion: '0.1',
          visibility: 'shared_participants',
          retentionClass: 'audit',
        }),
      ),
    );
  }

  private async journalLiveSessionState(interactionId: string) {
    const rows = await this.sql`
      SELECT session.interaction_id, session.initiator_agent_id, session.responder_agent_id,
        session.status, session.expires_at, session.created_at, session.activated_at,
        session.completed_at, interaction.initiator_operator_id,
        interaction.responder_operator_id
      FROM openclasp_live_sessions session
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id = session.interaction_id
      WHERE session.interaction_id = ${interactionId}
      LIMIT 1
    `;
    if (!rows[0]) return;
    const row = rows[0];
    const payload = LiveSessionStateRecordSchema.parse({
      interactionId: String(row.interaction_id),
      initiatorAgentId: String(row.initiator_agent_id),
      responderAgentId: String(row.responder_agent_id),
      status: String(row.status),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      createdAt: new Date(String(row.created_at)).toISOString(),
      ...(row.activated_at
        ? { activatedAt: new Date(String(row.activated_at)).toISOString() }
        : {}),
      ...(row.completed_at
        ? { completedAt: new Date(String(row.completed_at)).toISOString() }
        : {}),
      ...(row.status === 'failed' ? { failureCode: 'session_failed' } : {}),
    });
    const operatorIds = [
      ...new Set([String(row.initiator_operator_id), String(row.responder_operator_id)]),
    ];
    await Promise.all(
      operatorIds.map((operatorId) =>
        this.appendSourceRecord(operatorId, 'live_session_state', interactionId, payload, {
          schemaName: 'openclasp.live_session_state',
          schemaVersion: '0.1',
          visibility: 'shared_participants',
          retentionClass: 'audit',
          reportedAt: payload.completedAt ?? payload.activatedAt ?? payload.createdAt,
        }),
      ),
    );
  }

  private async journalLiveSessionEvent(payload: Record<string, unknown>) {
    const interactionId = String(payload.interactionId ?? '');
    const eventId = String(payload.eventId ?? '');
    if (!interactionId || !eventId) return;
    const operatorIds = await this.interactionOperatorIds(interactionId);
    await Promise.all(
      operatorIds.map((operatorId) =>
        this.appendSourceRecord(operatorId, 'live_session_event', eventId, payload, {
          schemaName: 'openclasp.live_session_event',
          schemaVersion: '0.1',
          visibility: 'shared_participants',
          retentionClass: 'audit',
        }),
      ),
    );
  }

  getRuntimeVerificationKey() {
    const [active, ...previous] = this.gatewaySecrets();
    return {
      algorithm: 'Ed25519' as const,
      keyId: getSessionKeyId(active!),
      publicKey: getSessionVerificationKey(active!),
      previousKeys: previous.map((secret) => ({
        algorithm: 'Ed25519' as const,
        keyId: getSessionKeyId(secret),
        publicKey: getSessionVerificationKey(secret),
      })),
    };
  }

  async upsert(
    operatorId: string,
    kind: HostedRecordKind,
    recordId: string,
    payload: unknown,
    metadata?: SourceRecordWriteMetadata,
  ): Promise<void> {
    await this.ensureSchema();
    const encoded = JSON.stringify(payload);
    if (!(metadata?.journal ?? shouldJournalSourceRecord(kind))) {
      await this.sql`
        INSERT INTO openclasp_records(operator_id, kind, record_id, payload)
        VALUES (${operatorId}, ${kind}, ${recordId}, ${encoded}::jsonb)
        ON CONFLICT (operator_id, kind, record_id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `;
      return;
    }
    const source = buildSourceRecordEnvelope({
      operatorId,
      kind,
      recordId,
      payload,
      ...(metadata ? { metadata } : {}),
    });
    const sourcePayload = JSON.stringify(source.payload);
    const sourceEntityRefs = JSON.stringify(source.entityRefs);
    await this.sql.transaction((transaction) => [
      transaction`
        INSERT INTO openclasp_records(operator_id, kind, record_id, payload)
        VALUES (${operatorId}, ${kind}, ${recordId}, ${encoded}::jsonb)
        ON CONFLICT (operator_id, kind, record_id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `,
      transaction`
        INSERT INTO openclasp_source_records(
          event_id,
          operator_id,
          kind,
          record_id,
          schema_name,
          schema_version,
          payload,
          payload_digest,
          entity_refs,
          provenance,
          visibility,
          retention_class,
          learning_scope,
          reported_at,
          ingested_at
        ) VALUES (
          ${source.eventId},
          ${source.operatorId},
          ${source.kind},
          ${source.recordId},
          ${source.schemaName},
          ${source.schemaVersion},
          ${sourcePayload}::jsonb,
          ${source.payloadDigest},
          ${sourceEntityRefs}::jsonb,
          ${source.provenance},
          ${source.visibility},
          ${source.retentionClass},
          ${source.learningScope},
          ${source.reportedAt},
          ${source.ingestedAt}
        )
        ON CONFLICT (operator_id, kind, record_id, payload_digest) DO NOTHING
      `,
    ]);
  }

  async list(
    operatorId: string,
  ): Promise<{ kind: HostedRecordKind; recordId: string; payload: any }[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT kind, record_id, payload
      FROM openclasp_records
      WHERE operator_id = ${operatorId}
      ORDER BY created_at ASC
    `;
    return rows.map((row) => ({
      kind: row.kind as HostedRecordKind,
      recordId: String(row.record_id),
      payload: row.payload,
    }));
  }

  async dashboard(operatorId: string) {
    await this.ensureSchema();
    const dueFeedback = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND payload->>'status' = 'pending'
        AND (payload->>'dueAt')::timestamptz <= NOW()
      LIMIT 1
    `;
    if (dueFeedback.length) await this.processDueFeedback().catch(() => undefined);
    const outstanding = await this.sql`
      SELECT DISTINCT report.payload->>'interactionId' AS interaction_id
      FROM openclasp_records report
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id::text = report.payload->>'interactionId'
      WHERE report.kind = 'completion_report'
        AND (
          interaction.initiator_operator_id = ${operatorId}
          OR interaction.responder_operator_id = ${operatorId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM openclasp_records conclusion
          WHERE conclusion.operator_id = ${operatorId}
            AND conclusion.kind = 'interaction_conclusion'
            AND conclusion.payload->>'interactionId' = report.payload->>'interactionId'
        )
      LIMIT 20
    `;
    for (const row of outstanding) {
      const interactionId = String(row.interaction_id ?? '');
      if (interactionId)
        await this.finalizeInteractionConclusion(interactionId).catch(() => undefined);
    }
    const intelligenceBackfill = await this.sql`
      SELECT DISTINCT interaction.interaction_id
      FROM openclasp_federated_interactions interaction
      INNER JOIN openclasp_records conclusion
        ON conclusion.payload->>'interactionId' = interaction.interaction_id::text
        AND conclusion.kind = 'interaction_conclusion'
        AND conclusion.payload->>'lifecycle' = 'final'
      WHERE (
          interaction.initiator_operator_id = ${operatorId}
          OR interaction.responder_operator_id = ${operatorId}
        )
        AND EXISTS (
          SELECT 1 FROM openclasp_records eligibility
          WHERE eligibility.kind = 'learning_eligibility'
            AND eligibility.payload->>'interactionId' = interaction.interaction_id::text
            AND eligibility.payload->>'eligible' = 'true'
        )
        AND NOT EXISTS (
          SELECT 1 FROM openclasp_records delta
          WHERE delta.operator_id = ${operatorId}
            AND delta.kind = 'profile_delta'
            AND delta.payload->>'interactionId' = interaction.interaction_id::text
            AND delta.payload->>'agentId' = CASE
              WHEN interaction.initiator_operator_id = ${operatorId}
                THEN interaction.initiator_agent_id::text
              ELSE interaction.responder_agent_id::text
            END
        )
      ORDER BY interaction.interaction_id DESC
      LIMIT 20
    `;
    for (const row of intelligenceBackfill) {
      const interactionId = String(row.interaction_id ?? '');
      if (interactionId)
        await this.finalizeInteractionConclusion(interactionId).catch(() => undefined);
    }
    const rows = await this.list(operatorId);
    const [federatedInteractions, runtimes, accessTokens, liveSessionRows, liveEventRows] =
      await Promise.all([
        this.listFederatedInteractions(operatorId),
        this.listAgentRuntimes(operatorId),
        this.listAgentAccessTokens(operatorId),
        this.sql`
        SELECT session.interaction_id, session.initiator_agent_id, session.responder_agent_id,
          session.status, session.created_at, session.activated_at, session.completed_at,
          session.expires_at, session.last_error
        FROM openclasp_live_sessions session
        INNER JOIN openclasp_federated_interactions interaction
          ON interaction.interaction_id = session.interaction_id
        WHERE interaction.initiator_operator_id = ${operatorId}
           OR interaction.responder_operator_id = ${operatorId}
        ORDER BY session.created_at DESC
      `,
        this.sql`
        SELECT events.event
        FROM openclasp_live_session_events events
        INNER JOIN openclasp_federated_interactions interaction
          ON interaction.interaction_id = events.interaction_id
        WHERE interaction.initiator_operator_id = ${operatorId}
           OR interaction.responder_operator_id = ${operatorId}
        ORDER BY events.created_at ASC
      `,
      ]);
    const ofKind = (kind: HostedRecordKind) =>
      rows.filter((row) => row.kind === kind).map((row) => row.payload);
    const agentProfiles = ofKind('agent_profile') as AgentProfile[];
    const hostedThreads = (
      await Promise.all(
        agentProfiles
          .filter(
            (agent) =>
              (agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat')) ===
              'temporary_chat',
          )
          .map((agent) => this.listHostedThreads(operatorId, agent.agentId)),
      )
    ).flat();
    const presence = new Map(
      rows
        .filter((row) => row.kind === 'presence')
        .map((row) => [row.recordId, String(row.payload.lastSeenAt)]),
    );
    const intelligenceSummaries = await this.listContextualIntelligence(operatorId);
    return {
      agents: [...ofKind('agent_profile'), ...ofKind('agent')].map((agent) => ({
        ...agent,
        presence: resolveAgentPresence(presence.get(String(agent.agentId))),
      })),
      projects: ofKind('project'),
      installations: ofKind('installation'),
      setupRequests: ofKind('setup_request'),
      publications: ofKind('publication'),
      interactions: ofKind('interaction'),
      events: [...ofKind('event'), ...liveEventRows.map((row) => row.event)],
      conflicts: ofKind('conflict'),
      receipts: ofKind('receipt'),
      profiles: ofKind('profile'),
      counterpartyBriefs: ofKind('counterparty_brief'),
      completionReports: ofKind('completion_report'),
      feedbackRequests: ofKind('feedback_request'),
      interactionFeedback: ofKind('interaction_feedback'),
      interactionConclusions: ofKind('interaction_conclusion'),
      learningEligibility: ofKind('learning_eligibility'),
      profileDeltas: ofKind('profile_delta'),
      intelligenceSummaries,
      federatedInteractions,
      liveSessions: liveSessionRows.map((row) => ({
        interactionId: String(row.interaction_id),
        initiatorAgentId: String(row.initiator_agent_id),
        responderAgentId: String(row.responder_agent_id),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString(),
        ...(row.activated_at
          ? { activatedAt: new Date(String(row.activated_at)).toISOString() }
          : {}),
        ...(row.completed_at
          ? { completedAt: new Date(String(row.completed_at)).toISOString() }
          : {}),
        expiresAt: new Date(String(row.expires_at)).toISOString(),
        ...(row.last_error ? { lastError: String(row.last_error) } : {}),
      })),
      hostedThreads,
      runtimes,
      accessTokens,
    };
  }

  async listContextualIntelligence(
    operatorId: string,
    input: { agentId?: string; taskCategory?: string } = {},
  ) {
    await this.ensureSchema();
    const [records, publicRows] = await Promise.all([
      this.list(operatorId),
      this
        .sql`SELECT agent_id, card FROM openclasp_public_agents ORDER BY updated_at DESC LIMIT 1000`,
    ]);
    const currentVersions = new Map<string, string>();
    for (const row of publicRows) {
      const card = PublicAgentCardSchema.safeParse(normalizePublicAgentCard(row.card));
      if (card.success) currentVersions.set(String(row.agent_id), card.data.agentVersion);
    }
    for (const record of records.filter((item) => item.kind === 'agent_profile')) {
      const profile = record.payload as Partial<AgentProfile>;
      if (typeof profile.agentId === 'string' && typeof profile.agentVersion === 'string')
        currentVersions.set(profile.agentId, profile.agentVersion);
    }
    const deltas = records
      .filter((record) => record.kind === 'profile_delta')
      .map((record) => BehaviouralProfileDeltaSchema.safeParse(record.payload))
      .filter((result) => result.success)
      .map((result) => result.data);
    return records
      .filter((record) => record.kind === 'profile')
      .map((record) => ({ recordId: record.recordId, ...record.payload }) as ContextualProfile)
      .filter(
        (profile) =>
          (!input.agentId || profile.agentId === input.agentId) &&
          (!input.taskCategory || profile.taskCategory === input.taskCategory),
      )
      .map((profile) =>
        summarizeContextualReliability({
          profile: {
            ...profile,
            effectiveSampleSize: profile.effectiveSampleSize ?? profile.sampleSize,
          },
          deltas: deltas.filter(
            (delta) =>
              delta.agentId === profile.agentId &&
              delta.agentVersion === profile.agentVersion &&
              delta.taskCategory === profile.taskCategory,
          ),
          currentAgentVersion: currentVersions.get(profile.agentId) ?? profile.agentVersion,
        }),
      )
      .sort((left, right) => {
        if (left.agentId !== right.agentId) return left.agentId.localeCompare(right.agentId);
        if (left.versionStatus.status !== right.versionStatus.status)
          return left.versionStatus.status === 'current' ? -1 : 1;
        return right.confidence.value - left.confidence.value;
      });
  }

  async issueAgentAccessToken(
    operatorId: string,
    agentId: string,
    input: { name: string; expiresInDays: number },
  ): Promise<AgentAccessTokenMetadata & { token: string }> {
    await this.ensureSchema();
    const agents = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const agent = agents[0]?.payload as AgentProfile | undefined;
    if (!agent) throw new Error('Owned agent not found');
    if (agent.status !== 'active') throw new Error('Revoked agents cannot receive access tokens');
    const name = input.name.trim();
    if (!name) throw new Error('Token name is required');
    const { tokenId, token, tokenHash } = createAgentAccessToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + input.expiresInDays * 86_400_000);
    // The credential is bound to one agent. It may use MCP outbound and let that
    // same agent register its own inbound runtime; it cannot manage other agents.
    const scopes = DEFAULT_AGENT_AUTH_SCOPES;
    await this.sql`
      INSERT INTO openclasp_agent_access_tokens(
        token_id, operator_id, agent_id, name, token_hash, scopes, expires_at, created_at
      ) VALUES (
        ${tokenId}, ${operatorId}, ${agentId}, ${name}, ${tokenHash},
        ${JSON.stringify(scopes)}::jsonb, ${expiresAt.toISOString()}, ${createdAt.toISOString()}
      )
    `;
    const clientId = agentAccessTokenClientId(tokenId);
    await this.upsert(operatorId, 'installation', clientId, {
      installationId: `install_${tokenId}`,
      clientId,
      agentId,
      projectId: agent.projectId,
      connectedAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    } satisfies AgentInstallation);
    return {
      tokenId,
      token,
      agentId,
      name,
      scopes,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listAgentAccessTokens(
    operatorId: string,
    agentId?: string,
  ): Promise<AgentAccessTokenMetadata[]> {
    await this.ensureSchema();
    const rows = agentId
      ? await this.sql`
          SELECT token_id, agent_id, name, scopes, expires_at, last_used_at, revoked_at, created_at
          FROM openclasp_agent_access_tokens
          WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
          ORDER BY created_at DESC
        `
      : await this.sql`
          SELECT token_id, agent_id, name, scopes, expires_at, last_used_at, revoked_at, created_at
          FROM openclasp_agent_access_tokens
          WHERE operator_id = ${operatorId}
          ORDER BY created_at DESC
        `;
    return rows.map((row) => ({
      tokenId: String(row.token_id),
      agentId: String(row.agent_id),
      name: String(row.name),
      scopes: Array.isArray(row.scopes)
        ? row.scopes.filter((scope): scope is string => typeof scope === 'string')
        : [],
      createdAt: new Date(String(row.created_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      ...(row.last_used_at ? { lastUsedAt: new Date(String(row.last_used_at)).toISOString() } : {}),
      ...(row.revoked_at ? { revokedAt: new Date(String(row.revoked_at)).toISOString() } : {}),
    }));
  }

  async revokeAgentAccessToken(operatorId: string, agentId: string, tokenId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_agent_access_tokens
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE token_id = ${tokenId} AND operator_id = ${operatorId} AND agent_id = ${agentId}
      RETURNING revoked_at
    `;
    if (!rows.length) throw new Error('Agent access token not found');
    const clientId = agentAccessTokenClientId(tokenId);
    await this.sql`
      DELETE FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'installation' AND record_id = ${clientId}
    `;
    return {
      tokenId,
      agentId,
      revokedAt: new Date(String(rows[0]?.revoked_at)).toISOString(),
    };
  }

  async verifyAgentAccessToken(token: string) {
    await this.ensureSchema();
    const tokenId = agentAccessTokenId(token);
    if (!tokenId) throw new Error('Invalid agent access token');
    const rows = await this.sql`
      SELECT tokens.operator_id, tokens.agent_id, tokens.token_hash, tokens.scopes,
        tokens.expires_at, profile.payload AS profile
      FROM openclasp_agent_access_tokens tokens
      INNER JOIN openclasp_records profile
        ON profile.operator_id = tokens.operator_id
        AND profile.kind = 'agent_profile'
        AND profile.record_id = tokens.agent_id
      WHERE tokens.token_id = ${tokenId} AND tokens.revoked_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || !matchesAgentAccessToken(token, String(row.token_hash)))
      throw new Error('Invalid agent access token');
    if (Date.parse(String(row.expires_at)) <= Date.now())
      throw new Error('Agent access token has expired');
    const profile = row.profile as Partial<AgentProfile>;
    if (profile.status !== 'active') throw new Error('Agent access token is disabled');
    await this.sql`
      UPDATE openclasp_agent_access_tokens
      SET last_used_at = NOW()
      WHERE token_id = ${tokenId}
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')
    `;
    return {
      tokenId,
      operatorId: String(row.operator_id),
      agentId: String(row.agent_id),
      clientId: agentAccessTokenClientId(tokenId),
      scopes: Array.isArray(row.scopes)
        ? row.scopes.filter((scope): scope is string => typeof scope === 'string')
        : [],
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
  }

  async publishAgent(operatorId: string, card: PublicAgentCard): Promise<PublicAgentCard> {
    await this.ensureSchema();
    card = PublicAgentCardSchema.parse(card);
    const runtimes = await this.sql`
      SELECT a2a_endpoint, endpoint FROM openclasp_agent_runtimes
      WHERE operator_id = ${operatorId} AND agent_id = ${card.agentId} AND status = 'verified'
    `;
    if (runtimes[0]) {
      card = PublicAgentCardSchema.parse({
        ...card,
        agentMode: 'persistent_runtime',
        transports: [
          {
            protocol: 'A2A/1.0',
            protocolBinding: 'JSONRPC',
            endpoint: String(runtimes[0].a2a_endpoint ?? runtimes[0].endpoint),
            managedBy: 'agent',
          },
        ],
      });
    }
    card = this.attestPublicAgentCard(card);
    const encoded = JSON.stringify(card);
    const rows = await this.sql`
      INSERT INTO openclasp_public_agents(agent_id, operator_id, card, published_at, updated_at)
      VALUES (${card.agentId}, ${operatorId}, ${encoded}::jsonb, NOW(), NOW())
      ON CONFLICT (agent_id) DO UPDATE SET
        card = EXCLUDED.card,
        updated_at = NOW()
      WHERE openclasp_public_agents.operator_id = ${operatorId}
      RETURNING card
    `;
    const published = rows[0]?.card as PublicAgentCard | undefined;
    if (!published) throw new Error('Agent ID is already owned by another operator');
    return PublicAgentCardSchema.parse(published);
  }

  async unpublishAgent(operatorId: string, agentId: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.sql`
      DELETE FROM openclasp_public_agents
      WHERE agent_id = ${agentId} AND operator_id = ${operatorId}
      RETURNING agent_id
    `;
    return rows.length > 0;
  }

  async getPublishedAgent(agentId: string): Promise<PublicAgentCard | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT agents.card, runtime.a2a_endpoint, runtime.endpoint, profile.payload AS profile
      FROM openclasp_public_agents agents
      LEFT JOIN openclasp_agent_runtimes runtime
        ON runtime.agent_id = agents.agent_id AND runtime.status = 'verified'
      LEFT JOIN openclasp_records profile
        ON profile.operator_id = agents.operator_id AND profile.kind = 'agent_profile'
        AND profile.record_id = agents.agent_id
      WHERE agents.agent_id = ${agentId}
    `;
    if (!rows[0]?.card) return undefined;
    let card = normalizePublicAgentCard(rows[0].card);
    const profile = rows[0].profile as Partial<AgentProfile> | undefined;
    const mode =
      profile?.agentMode ??
      (rows[0].a2a_endpoint || rows[0].endpoint ? 'persistent_runtime' : 'temporary_chat');
    if (mode === 'temporary_chat') {
      const root = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
        /\/$/,
        '',
      );
      card = PublicAgentCardSchema.parse({
        ...card,
        agentMode: 'temporary_chat',
        transports: [
          {
            protocol: 'A2A/1.0',
            protocolBinding: 'JSONRPC',
            endpoint: `${root}/a2a/temporary/${encodeURIComponent(agentId)}`,
            managedBy: 'openclasp',
          },
        ],
      });
    } else if (rows[0].a2a_endpoint || rows[0].endpoint)
      card = PublicAgentCardSchema.parse({
        ...card,
        agentMode: 'persistent_runtime',
        transports: [
          {
            protocol: 'A2A/1.0',
            protocolBinding: 'JSONRPC',
            endpoint: String(rows[0].a2a_endpoint ?? rows[0].endpoint),
            managedBy: 'agent',
          },
        ],
      });
    return this.attestPublicAgentCard({ ...card, presence: await this.getAgentPresence(agentId) });
  }

  async resolveAgentReference(reference: string): Promise<AgentResolution | undefined> {
    await this.ensureSchema();
    const normalizedReference = reference.trim().replace(/\/$/, '');
    if (!normalizedReference || normalizedReference.length > 2048)
      throw new Error('Agent reference is invalid');
    const rows = await this.sql`
      SELECT agent_id, card
      FROM openclasp_public_agents
      WHERE agent_id = ${normalizedReference}
        OR card->>'slug' = ${normalizedReference}
        OR RTRIM(card->>'profileUrl', '/') = ${normalizedReference}
        OR RTRIM(card->>'cardUrl', '/') = ${normalizedReference}
        OR RTRIM(card->>'a2aAgentCardUrl', '/') = ${normalizedReference}
      LIMIT 1
    `;
    let row = rows[0];
    if (!row) {
      const legacyRows = await this.sql`
        SELECT agent_id, card
        FROM openclasp_public_agents
        ORDER BY updated_at DESC
        LIMIT 1000
      `;
      row = legacyRows.find((candidate) => {
        const card = normalizePublicAgentCard(candidate.card);
        return [card.slug, card.profileUrl, card.cardUrl, card.a2aAgentCardUrl]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.replace(/\/$/, '') === normalizedReference);
      });
    }
    if (!row) return undefined;
    const stored = normalizePublicAgentCard(row.card);
    const matchedBy =
      String(row.agent_id) === normalizedReference
        ? 'agent_id'
        : stored.slug === normalizedReference
          ? 'slug'
          : stored.profileUrl?.replace(/\/$/, '') === normalizedReference
            ? 'profile_url'
            : stored.cardUrl.replace(/\/$/, '') === normalizedReference
              ? 'card_url'
              : 'a2a_card_url';
    const card = await this.getPublishedAgent(String(row.agent_id));
    if (!card) return undefined;
    return AgentResolutionSchema.parse({
      reference,
      matchedBy,
      verified: true,
      card,
      resolvedAt: new Date().toISOString(),
    });
  }

  async searchPublishedAgents(input: {
    query?: string | undefined;
    capability?: string | undefined;
    limit?: number | undefined;
  }): Promise<PublicAgentCard[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT agents.card, runtime.a2a_endpoint, runtime.endpoint, profile.payload AS profile
      FROM openclasp_public_agents agents
      LEFT JOIN openclasp_agent_runtimes runtime
        ON runtime.agent_id = agents.agent_id AND runtime.status = 'verified'
      LEFT JOIN openclasp_records profile
        ON profile.operator_id = agents.operator_id AND profile.kind = 'agent_profile'
        AND profile.record_id = agents.agent_id
      ORDER BY agents.updated_at DESC LIMIT 100
    `;
    const query = input.query?.trim().toLowerCase();
    const capability = input.capability?.trim().toLowerCase();
    const presenceRows = await this.sql`
      SELECT records.record_id, records.payload
      FROM openclasp_records records
      INNER JOIN openclasp_public_agents agents ON agents.agent_id = records.record_id
      WHERE records.kind = 'presence'
    `;
    const presence = new Map(
      presenceRows.map((row) => [String(row.record_id), String(row.payload.lastSeenAt)]),
    );
    return rows
      .map((row) => {
        let card = normalizePublicAgentCard(row.card);
        const profile = row.profile as Partial<AgentProfile> | undefined;
        const mode =
          profile?.agentMode ??
          (row.a2a_endpoint || row.endpoint ? 'persistent_runtime' : 'temporary_chat');
        if (mode === 'temporary_chat') {
          const root = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
            /\/$/,
            '',
          );
          card = PublicAgentCardSchema.parse({
            ...card,
            agentMode: 'temporary_chat',
            transports: [
              {
                protocol: 'A2A/1.0',
                protocolBinding: 'JSONRPC',
                endpoint: `${root}/a2a/temporary/${encodeURIComponent(card.agentId)}`,
                managedBy: 'openclasp',
              },
            ],
          });
        } else if (row.a2a_endpoint || row.endpoint)
          card = PublicAgentCardSchema.parse({
            ...card,
            agentMode: 'persistent_runtime',
            transports: [
              {
                protocol: 'A2A/1.0',
                protocolBinding: 'JSONRPC',
                endpoint: String(row.a2a_endpoint ?? row.endpoint),
                managedBy: 'agent',
              },
            ],
          });
        return this.attestPublicAgentCard({
          ...card,
          presence: resolveAgentPresence(presence.get(card.agentId)),
        });
      })
      .filter(
        (card) =>
          (!query ||
            card.agentId.toLowerCase().includes(query) ||
            card.slug?.includes(query) ||
            card.name.toLowerCase().includes(query) ||
            card.description.toLowerCase().includes(query) ||
            card.framework.toLowerCase().includes(query) ||
            card.capabilities.some((value) => value.toLowerCase().includes(query)) ||
            card.limitations.some((value) => value.toLowerCase().includes(query))) &&
          (!capability ||
            card.capabilities.some((value) => value.toLowerCase().includes(capability))),
      )
      .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));
  }

  async searchPersonalizedMarketplace(
    operatorId: string,
    input: {
      agentId?: string;
      taskCategory?: string;
      query?: string;
      limit?: number;
    } = {},
  ) {
    const [cards, records, summaries] = await Promise.all([
      this.searchPublishedAgents({ query: input.query, limit: input.limit }),
      this.list(operatorId),
      this.listContextualIntelligence(operatorId, {
        ...(input.taskCategory ? { taskCategory: input.taskCategory } : {}),
      }),
    ]);
    const ownedAgents = records
      .filter((record) => record.kind === 'agent_profile')
      .map((record) => record.payload as Partial<AgentProfile>);
    const ownedIds = new Set(ownedAgents.map((agent) => agent.agentId));
    const selected = ownedAgents.find((agent) => agent.agentId === input.agentId);
    const taskCategory = input.taskCategory ?? selected?.capabilities?.[0] ?? 'general';
    const normalizedCategory = taskCategory.toLowerCase();
    const summaryFor = (agentId: string) =>
      summaries.find(
        (summary) =>
          summary.agentId === agentId &&
          summary.taskCategory.toLowerCase() === normalizedCategory &&
          summary.versionStatus.status === 'current',
      ) ?? summaries.find((summary) => summary.agentId === agentId);
    return cards
      .filter(
        (card) =>
          card.agentMode === 'persistent_runtime' &&
          card.transports.some((transport) => transport.managedBy === 'agent'),
      )
      .filter((card) => !ownedIds.has(card.agentId))
      .map((card) => {
        const intelligence = summaryFor(card.agentId);
        const capabilityMatch = card.capabilities.some((capability) =>
          capability.toLowerCase().includes(normalizedCategory),
        );
        const online = card.presence?.status === 'online';
        const fitScore = Math.min(
          1,
          0.25 +
            (capabilityMatch ? 0.35 : 0) +
            (online ? 0.1 : 0) +
            (intelligence ? intelligence.score * intelligence.confidence.value * 0.3 : 0),
        );
        return {
          card,
          taskCategory,
          ...(intelligence ? { contextualReliability: intelligence } : {}),
          match: {
            score: fitScore,
            label: fitScore >= 0.72 ? 'strong' : fitScore >= 0.48 ? 'possible' : 'unproven',
            reasons: [
              capabilityMatch
                ? `Published capability matches ${taskCategory}`
                : `No explicit ${taskCategory} capability`,
              intelligence
                ? `${intelligence.confidence.evidenceCount} verified outcomes in private history`
                : 'No verified private history for this task',
              online ? 'Currently online' : 'Currently offline',
            ],
          },
        };
      })
      .sort((left, right) => right.match.score - left.match.score);
  }

  async touchAgentPresence(operatorId: string, agentId: string): Promise<AgentPresence> {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    if (!owned.length) throw new Error('Agent is not owned by this account');
    const lastSeenAt = new Date().toISOString();
    await this.upsert(operatorId, 'presence', agentId, { lastSeenAt });
    await this.sql`
      UPDATE openclasp_agent_runtimes SET last_seen_at = ${lastSeenAt}, updated_at = NOW()
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId} AND status = 'verified'
    `;
    return resolveAgentPresence(lastSeenAt);
  }

  async getAgentPresence(agentId: string): Promise<AgentPresence> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT records.payload
      FROM openclasp_public_agents agents
      LEFT JOIN openclasp_records records
        ON records.operator_id = agents.operator_id
        AND records.kind = 'presence'
        AND records.record_id = agents.agent_id
      WHERE agents.agent_id = ${agentId}
      LIMIT 1
    `;
    if (!rows.length) throw new Error('Published agent not found');
    const lastSeenAt = rows[0]?.payload?.lastSeenAt;
    return resolveAgentPresence(typeof lastSeenAt === 'string' ? lastSeenAt : undefined);
  }

  async listAgentRuntimes(operatorId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT agent_id, endpoint, a2a_endpoint, status, verified_at, last_seen_at, last_error, updated_at
      FROM openclasp_agent_runtimes
      WHERE operator_id = ${operatorId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => ({
      agentId: String(row.agent_id),
      endpoint: String(row.endpoint),
      a2aEndpoint: String(row.a2a_endpoint ?? row.endpoint),
      status: row.status as 'verified' | 'disabled',
      verifiedAt: new Date(String(row.verified_at)).toISOString(),
      ...(row.last_seen_at ? { lastSeenAt: new Date(String(row.last_seen_at)).toISOString() } : {}),
      ...(row.last_error ? { lastError: String(row.last_error) } : {}),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async registerAgentRuntime(operatorId: string, agentId: string, endpoint: string) {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    if (!owned.length) throw new Error('Agent is not owned by this account');
    const challenge = crypto.randomUUID();
    const verification = await postRuntimeJson(endpoint, {
      type: 'openclasp.runtime.verify',
      version: '1',
      agentId,
      challenge,
    });
    if (
      verification.status < 200 ||
      verification.status >= 300 ||
      !verification.body ||
      typeof verification.body !== 'object' ||
      (verification.body as { type?: unknown }).type !== 'openclasp.runtime.verified' ||
      (verification.body as { version?: unknown }).version !== '1' ||
      (verification.body as { agentId?: unknown }).agentId !== agentId ||
      (verification.body as { challenge?: unknown }).challenge !== challenge
    )
      throw new Error('Runtime endpoint did not return the verification challenge');
    const a2aEndpointValue = (verification.body as { a2aEndpoint?: unknown }).a2aEndpoint;
    const a2aEndpoint =
      typeof a2aEndpointValue === 'string' && a2aEndpointValue ? a2aEndpointValue : endpoint;
    await resolvePublicRuntimeEndpoint(a2aEndpoint);
    const runtimeSecret = randomBytes(32).toString('base64url');
    const encrypted = encryptGatewayPayload(this.gatewaySecret(), runtimeSecret);
    const verifiedAt = new Date().toISOString();
    const saved = await this.sql`
      INSERT INTO openclasp_agent_runtimes(
        agent_id, operator_id, endpoint, a2a_endpoint, secret_ciphertext, secret_iv, secret_auth_tag,
        status, verified_at, last_seen_at, updated_at
      ) VALUES (
        ${agentId}, ${operatorId}, ${endpoint}, ${a2aEndpoint}, ${encrypted.ciphertext},
        ${encrypted.iv}, ${encrypted.authTag}, 'verified', ${verifiedAt}, ${verifiedAt}, NOW()
      )
      ON CONFLICT (agent_id) DO UPDATE SET
        operator_id = EXCLUDED.operator_id,
        endpoint = EXCLUDED.endpoint,
        a2a_endpoint = EXCLUDED.a2a_endpoint,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        secret_iv = EXCLUDED.secret_iv,
        secret_auth_tag = EXCLUDED.secret_auth_tag,
        status = 'verified',
        verified_at = EXCLUDED.verified_at,
        last_seen_at = EXCLUDED.last_seen_at,
        last_error = NULL,
        updated_at = NOW()
      WHERE openclasp_agent_runtimes.operator_id = ${operatorId}
      RETURNING agent_id
    `;
    if (!saved.length) throw new Error('Agent runtime is owned by another account');
    await this.sql`
      UPDATE openclasp_public_agents
      SET card = jsonb_set(
          jsonb_set(
            card,
            '{transports}',
            ${JSON.stringify([
              {
                protocol: 'A2A/1.0',
                protocolBinding: 'JSONRPC',
                endpoint: a2aEndpoint,
                managedBy: 'agent',
              },
            ])}::jsonb
          ),
          '{agentMode}', '"persistent_runtime"'::jsonb
        ), updated_at = NOW()
      WHERE agent_id = ${agentId} AND operator_id = ${operatorId}
    `;
    await this.sql`
      UPDATE openclasp_records
      SET payload = jsonb_set(
          jsonb_set(payload, '{a2aEndpoint}', to_jsonb(${a2aEndpoint}::text)),
          '{agentMode}', '"persistent_runtime"'::jsonb
        ),
        updated_at = NOW()
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    await this.touchAgentPresence(operatorId, agentId);
    return {
      agentId,
      endpoint,
      a2aEndpoint,
      status: 'verified' as const,
      verifiedAt,
      verificationKey: getSessionVerificationKey(this.gatewaySecret()),
    };
  }

  async disableAgentRuntime(operatorId: string, agentId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_agent_runtimes
      SET status = 'disabled', updated_at = NOW()
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
      RETURNING agent_id
    `;
    if (!rows.length) throw new Error('Agent runtime not found');
    return { agentId, status: 'disabled' as const };
  }

  async deleteAgent(operatorId: string, agentId: string) {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'agent_profile'
        AND record_id = ${agentId}
      LIMIT 1
    `;
    if (!owned.length) throw new Error('Owned agent not found');
    const openInteractions = await this.sql`
      SELECT interaction_id FROM openclasp_federated_interactions
      WHERE (initiator_agent_id = ${agentId} OR responder_agent_id = ${agentId})
        AND status IN ('pending', 'active')
      LIMIT 1
    `;
    if (openInteractions.length) {
      const error = new Error('Finish or reject the agent’s open interactions before deleting it');
      Object.assign(error, { statusCode: 409 });
      throw error;
    }
    await this.sql`
      DELETE FROM openclasp_hosted_threads
      WHERE participant_a_agent_id = ${agentId} OR participant_b_agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_public_agents
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_agent_runtimes
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_agent_access_tokens
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND (
          (record_id = ${agentId} AND kind IN ('agent', 'agent_profile', 'publication', 'presence'))
          OR (kind = 'installation' AND payload->>'agentId' = ${agentId})
          OR (kind = 'setup_request' AND payload->>'existingAgentId' = ${agentId})
        )
    `;
    return {
      agentId,
      deleted: true as const,
      historyRetained: true as const,
    };
  }

  private async sessionParticipant(agentId: string) {
    const rows = await this.sql`
      SELECT agents.operator_id, agents.card, profile.payload AS profile,
        runtime.endpoint, runtime.a2a_endpoint
      FROM openclasp_public_agents agents
      LEFT JOIN openclasp_records profile
        ON profile.operator_id = agents.operator_id
        AND profile.kind = 'agent_profile'
        AND profile.record_id = agents.agent_id
      LEFT JOIN openclasp_agent_runtimes runtime
        ON runtime.agent_id = agents.agent_id AND runtime.status = 'verified'
      WHERE agents.agent_id = ${agentId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error(`Published agent ${agentId} was not found`);
    const card = normalizePublicAgentCard(row.card);
    const profile = row.profile as Partial<AgentProfile> | undefined;
    const mode =
      profile?.agentMode ??
      (row.endpoint || row.a2a_endpoint ? 'persistent_runtime' : 'temporary_chat');
    if (mode === 'persistent_runtime' && !row.endpoint)
      throw new Error(`Agent ${agentId} does not have a verified live runtime`);
    const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
      /\/$/,
      '',
    );
    return {
      agentId,
      operatorId: String(row.operator_id),
      mode: mode as 'persistent_runtime' | 'temporary_chat',
      ...(row.endpoint ? { callbackEndpoint: String(row.endpoint) } : {}),
      a2aEndpoint:
        mode === 'temporary_chat'
          ? `${baseUrl}/a2a/temporary/${encodeURIComponent(agentId)}`
          : String(row.a2a_endpoint ?? row.endpoint),
      card: PublicAgentCardSchema.parse({ ...card, agentMode: mode }),
    };
  }

  private async signedRuntimeRequest(
    runtime: { callbackEndpoint: string },
    requestId: string,
    value: unknown,
  ) {
    const body = JSON.stringify(value);
    const timestamp = new Date().toISOString();
    return postRuntimeJson(runtime.callbackEndpoint, value, {
      'openclasp-request-id': requestId,
      'openclasp-timestamp': timestamp,
      'openclasp-signature': `v1=${signSessionControl(this.gatewaySecret(), requestId, timestamp, body)}`,
    });
  }

  private sessionGrant(
    interaction: FederatedInteraction,
    senderAgentId: string,
    recipientAgentId: string,
  ) {
    return issueSessionGrant(this.gatewaySecret(), {
      interactionId: interaction.interactionId,
      senderAgentId,
      recipientAgentId,
      expiresAt: Math.min(Date.parse(interaction.expiresAt), Date.now() + 60 * 60_000),
    });
  }

  private async privateCounterpartyInsights(
    viewerOperatorId: string,
    counterparty: { agentId: string; card: PublicAgentCard },
    taskCategory: string,
  ): Promise<{
    insights: LiveSessionInsight[];
    relevantSampleSize: number;
    historyConfidence: number;
  }> {
    const rows = await this.sql`
      SELECT record_id, payload
      FROM openclasp_records
      WHERE operator_id = ${viewerOperatorId}
        AND kind = 'profile'
        AND payload->>'agentId' = ${counterparty.agentId}
        AND payload->>'taskCategory' = ${taskCategory}
      ORDER BY (payload->>'sampleSize')::integer DESC, updated_at DESC
    `;
    const profiles: ContextualProfile[] = rows
      .map<Record<string, unknown>>((row) => ({
        recordId: String(row.record_id),
        ...(row.payload as Record<string, unknown>),
      }))
      .filter(
        (profile) =>
          typeof profile.agentVersion === 'string' &&
          typeof profile.sampleSize === 'number' &&
          typeof profile.updatedAt === 'string' &&
          typeof profile.completion === 'number' &&
          typeof profile.acceptance === 'number' &&
          typeof profile.specification === 'number' &&
          typeof profile.deadline === 'number' &&
          typeof profile.communication === 'number' &&
          typeof profile.evidence === 'number' &&
          typeof profile.scope === 'number' &&
          typeof profile.disputes === 'number',
      ) as ContextualProfile[];
    const exact = profiles.find(
      (profile) => profile.agentVersion === counterparty.card.agentVersion,
    );
    const current = exact ?? profiles[0];
    const insights: LiveSessionInsight[] = [];
    let relevantSampleSize = 0;
    let historyConfidence = 0;
    if (!current) {
      insights.push({
        code: 'limited_verified_history',
        severity: 'caution',
        message: `No eligible ${taskCategory} history is available for this agent version. Ask for task-relevant evidence.`,
        evidenceReferences: [],
        requirementReferences: [],
      });
    } else {
      const ageDays = Math.max(
        0,
        (Date.now() - Date.parse(String(current.updatedAt))) / 86_400_000,
      );
      const freshness = Math.exp(-ageDays / 180);
      const sampleSize = Number(current.sampleSize);
      const effectiveSampleSize = Number(current.effectiveSampleSize ?? sampleSize);
      const versionChanged = current.agentVersion !== counterparty.card.agentVersion;
      const confidence = Math.min(
        0.95,
        (effectiveSampleSize / (effectiveSampleSize + 5)) * freshness * (versionChanged ? 0.35 : 1),
      );
      relevantSampleSize = sampleSize;
      historyConfidence = confidence;
      const reference = `openclasp:profile:${current.recordId}`;
      insights.push({
        code: versionChanged ? 'version_history_only' : 'contextual_history',
        severity: versionChanged || confidence < 0.25 ? 'caution' : 'info',
        message: versionChanged
          ? `Only prior-version ${taskCategory} history is available (${sampleSize} eligible interaction${sampleSize === 1 ? '' : 's'}); confidence is reduced for version ${counterparty.card.agentVersion}.`
          : `Based on ${sampleSize} eligible ${taskCategory} interaction${sampleSize === 1 ? '' : 's'}; confidence ${(confidence * 100).toFixed(0)}%.`,
        evidenceReferences: [reference],
        requirementReferences: [],
      });
      const weakDimensions = [
        ['completion', Number(current.completion)],
        ['output acceptance', Number(current.acceptance)],
        ['specification adherence', Number(current.specification)],
        ['deadline reliability', Number(current.deadline)],
        ['communication quality', Number(current.communication)],
        ['evidence quality', Number(current.evidence)],
        ['scope adherence', Number(current.scope)],
      ].filter(([, score]) => Number(score) < 0.7);
      if (weakDimensions.length)
        insights.push({
          code: 'historical_weaknesses',
          severity: weakDimensions.some(([, score]) => Number(score) < 0.5) ? 'high' : 'caution',
          message: `Observed weaker areas: ${weakDimensions
            .map(([name, score]) => `${String(name)} ${(Number(score) * 100).toFixed(0)}%`)
            .join(', ')}.`,
          evidenceReferences: [reference],
          requirementReferences: [],
        });
      if (Number(current.disputes) > 0.25)
        insights.push({
          code: 'elevated_dispute_history',
          severity: Number(current.disputes) >= 0.5 ? 'high' : 'caution',
          message: `Eligible feedback shows a ${(Number(current.disputes) * 100).toFixed(0)}% dispute rate in this task category.`,
          evidenceReferences: [reference],
          requirementReferences: [],
        });
    }
    if (counterparty.card.limitations.length)
      insights.push({
        code: 'declared_limitations',
        severity: 'info',
        message: `Counterparty declares: ${counterparty.card.limitations.join('; ')}`,
        evidenceReferences: [counterparty.card.cardUrl],
        requirementReferences: [],
      });
    return { insights, relevantSampleSize, historyConfidence };
  }

  async brokerLiveSession(interaction: FederatedInteraction) {
    await this.ensureSchema();
    const existing = await this.sql`
      SELECT status FROM openclasp_live_sessions
      WHERE interaction_id = ${interaction.interactionId}
    `;
    if (existing[0]?.status === 'active') return;
    const [initiator, responder] = await Promise.all([
      this.sessionParticipant(interaction.initiatorAgentId),
      this.sessionParticipant(interaction.responderAgentId),
    ]);
    if (initiator.mode === 'temporary_chat' && responder.mode === 'temporary_chat')
      throw new Error('Temporary-to-temporary hosted conversations are not supported in this MVP');
    const [initiatorContext, responderContext] = await Promise.all([
      this.privateCounterpartyInsights(
        initiator.operatorId,
        responder,
        interaction.contract.taskCategory,
      ),
      this.privateCounterpartyInsights(
        responder.operatorId,
        initiator,
        interaction.contract.taskCategory,
      ),
    ]);
    const issuedAt = new Date().toISOString();
    const initiatorBrief = buildCounterpartyBrief({
      interactionId: interaction.interactionId,
      contractHash: interaction.termsHash,
      contract: interaction.contract,
      recipientAgentId: initiator.agentId,
      subject: responder.card,
      historyInsights: initiatorContext.insights,
      relevantSampleSize: initiatorContext.relevantSampleSize,
      historyConfidence: initiatorContext.historyConfidence,
      generatedAt: issuedAt,
      expiresAt: interaction.expiresAt,
    });
    const responderBrief = buildCounterpartyBrief({
      interactionId: interaction.interactionId,
      contractHash: interaction.termsHash,
      contract: interaction.contract,
      recipientAgentId: responder.agentId,
      subject: initiator.card,
      historyInsights: responderContext.insights,
      relevantSampleSize: responderContext.relevantSampleSize,
      historyConfidence: responderContext.historyConfidence,
      generatedAt: issuedAt,
      expiresAt: interaction.expiresAt,
    });
    await Promise.all([
      this.upsert(
        initiator.operatorId,
        'counterparty_brief',
        initiatorBrief.briefId,
        initiatorBrief,
      ),
      this.upsert(
        responder.operatorId,
        'counterparty_brief',
        responderBrief.briefId,
        responderBrief,
      ),
    ]);
    const makeOffer = (
      runtime: typeof initiator,
      counterparty: typeof responder,
      role: 'initiator' | 'responder',
      privateInsights: LiveSessionInsight[],
      counterpartyBrief: CounterpartyBrief,
    ) =>
      LiveSessionOfferSchema.parse({
        type: 'openclasp.session.offer',
        version: '1',
        offerId: crypto.randomUUID(),
        interactionId: interaction.interactionId,
        agentId: runtime.agentId,
        role,
        counterparty: {
          agentId: counterparty.agentId,
          name: counterparty.card.name,
          agentVersion: counterparty.card.agentVersion,
          capabilities: counterparty.card.capabilities,
        },
        contract: interaction.contract,
        contractHash: interaction.termsHash,
        privateInsights,
        counterpartyBrief,
        issuedAt,
        expiresAt: interaction.expiresAt,
      });
    const initiatorOffer = makeOffer(
      initiator,
      responder,
      'initiator',
      initiatorBrief.insights,
      initiatorBrief,
    );
    const responderOffer = makeOffer(
      responder,
      initiator,
      'responder',
      responderBrief.insights,
      responderBrief,
    );
    const prepare = async (
      participant: typeof initiator,
      offer: typeof initiatorOffer,
      label: 'Initiator' | 'Responder',
    ) => {
      if (participant.mode === 'temporary_chat')
        return LiveSessionAcceptanceSchema.parse({
          type: 'openclasp.session.accepted',
          version: '1',
          offerId: offer.offerId,
          interactionId: interaction.interactionId,
          agentId: participant.agentId,
          sessionId: crypto.randomUUID(),
          a2aEndpoint: participant.a2aEndpoint,
          expiresAt: interaction.expiresAt,
        });
      if (!participant.callbackEndpoint) throw new Error(`${label} runtime is not configured`);
      const response = await this.signedRuntimeRequest(
        { callbackEndpoint: participant.callbackEndpoint },
        offer.offerId,
        offer,
      );
      if (response.status < 200 || response.status >= 300)
        throw new Error(`${label} runtime is not live (HTTP ${response.status})`);
      return LiveSessionAcceptanceSchema.parse(response.body);
    };
    const [initiatorAcceptance, responderAcceptance] = await Promise.all([
      prepare(initiator, initiatorOffer, 'Initiator'),
      prepare(responder, responderOffer, 'Responder'),
    ]);
    if (
      initiatorAcceptance.offerId !== initiatorOffer.offerId ||
      initiatorAcceptance.agentId !== initiator.agentId ||
      responderAcceptance.offerId !== responderOffer.offerId ||
      responderAcceptance.agentId !== responder.agentId
    )
      throw new Error('Runtime returned a mismatched live-session acceptance');
    await Promise.all([
      ...(initiator.mode === 'persistent_runtime'
        ? [resolvePublicRuntimeEndpoint(initiatorAcceptance.a2aEndpoint)]
        : []),
      ...(responder.mode === 'persistent_runtime'
        ? [resolvePublicRuntimeEndpoint(responderAcceptance.a2aEndpoint)]
        : []),
    ]);
    await this.sql`
      INSERT INTO openclasp_live_sessions(
        interaction_id, initiator_agent_id, responder_agent_id,
        initiator_session_id, responder_session_id,
        initiator_endpoint, responder_endpoint, status, expires_at
      ) VALUES (
        ${interaction.interactionId}, ${interaction.initiatorAgentId}, ${interaction.responderAgentId},
        ${initiatorAcceptance.sessionId}, ${responderAcceptance.sessionId},
        ${initiatorAcceptance.a2aEndpoint}, ${responderAcceptance.a2aEndpoint},
        'preparing', ${interaction.expiresAt}
      )
      ON CONFLICT (interaction_id) DO UPDATE SET
        initiator_session_id = EXCLUDED.initiator_session_id,
        responder_session_id = EXCLUDED.responder_session_id,
        initiator_endpoint = EXCLUDED.initiator_endpoint,
        responder_endpoint = EXCLUDED.responder_endpoint,
        status = 'preparing', expires_at = EXCLUDED.expires_at,
        activated_at = NULL, completed_at = NULL, last_error = NULL
    `;
    await this.journalLiveSessionState(interaction.interactionId);
    const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
      /\/$/,
      '',
    );
    const activatedAt = new Date().toISOString();
    const verificationKey = getSessionVerificationKey(this.gatewaySecret());
    const makeActivation = (
      agentId: string,
      sessionId: string,
      role: 'initiator' | 'responder',
      peerAgentId: string,
      peerSessionId: string,
      peerEndpoint: string,
      privateInsights: LiveSessionInsight[],
      counterpartyBrief: CounterpartyBrief,
    ): LiveSessionActivation => {
      const bearerToken = this.sessionGrant(interaction, agentId, peerAgentId);
      return LiveSessionActivationSchema.parse({
        type: 'openclasp.session.activation',
        version: '1',
        activationId: crypto.randomUUID(),
        interactionId: interaction.interactionId,
        agentId,
        sessionId,
        role,
        peer: {
          agentId: peerAgentId,
          sessionId: peerSessionId,
          endpoint: peerEndpoint,
          bearerToken,
          verificationKey,
        },
        reporting: {
          endpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/events`,
          completionEndpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/completion-reports`,
          feedbackEndpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/feedback`,
          bearerToken,
        },
        privateInsights,
        counterpartyBrief,
        contractHash: interaction.termsHash,
        activatedAt,
        expiresAt: interaction.expiresAt,
      });
    };
    const initiatorActivation = makeActivation(
      initiator.agentId,
      initiatorAcceptance.sessionId,
      'initiator',
      responder.agentId,
      responderAcceptance.sessionId,
      responderAcceptance.a2aEndpoint,
      initiatorBrief.insights,
      initiatorBrief,
    );
    const responderActivation = makeActivation(
      responder.agentId,
      responderAcceptance.sessionId,
      'responder',
      initiator.agentId,
      initiatorAcceptance.sessionId,
      initiatorAcceptance.a2aEndpoint,
      responderBrief.insights,
      responderBrief,
    );
    try {
      const activate = async (
        participant: typeof initiator,
        activation: LiveSessionActivation,
        label: 'Initiator' | 'Responder',
      ) => {
        if (participant.mode === 'temporary_chat') return;
        if (!participant.callbackEndpoint) throw new Error(`${label} runtime is not configured`);
        const response = await this.signedRuntimeRequest(
          { callbackEndpoint: participant.callbackEndpoint },
          activation.activationId,
          activation,
        );
        if (response.status < 200 || response.status >= 300)
          throw new Error(`${label} activation failed with HTTP ${response.status}`);
      };
      await activate(responder, responderActivation, 'Responder');
      await activate(initiator, initiatorActivation, 'Initiator');
      await this.sql`
        UPDATE openclasp_live_sessions
        SET status = 'active', activated_at = NOW(), last_error = NULL
        WHERE interaction_id = ${interaction.interactionId}
      `;
      await this.journalLiveSessionState(interaction.interactionId);
      await this.sql`
        UPDATE openclasp_agent_runtimes
        SET last_seen_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE agent_id IN (${initiator.agentId}, ${responder.agentId})
      `;
      await Promise.all([
        this.touchAgentPresence(initiator.operatorId, initiator.agentId),
        this.touchAgentPresence(responder.operatorId, responder.agentId),
      ]);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 500) : 'Session activation failed';
      await this.sql`
        UPDATE openclasp_live_sessions SET status = 'failed', last_error = ${reason}
        WHERE interaction_id = ${interaction.interactionId}
      `;
      await this.journalLiveSessionState(interaction.interactionId);
      throw error;
    }
  }

  async getLiveSession(operatorId: string, interactionId: string, agentId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT session.*, interaction.payload,
        initiator.operator_id AS initiator_operator_id,
        responder.operator_id AS responder_operator_id
      FROM openclasp_live_sessions session
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id = session.interaction_id
      INNER JOIN openclasp_public_agents initiator
        ON initiator.agent_id = session.initiator_agent_id
      INNER JOIN openclasp_public_agents responder
        ON responder.agent_id = session.responder_agent_id
      WHERE session.interaction_id = ${interactionId} AND session.status = 'active'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error('Active live session not found');
    const isInitiator = row.initiator_agent_id === agentId;
    const isResponder = row.responder_agent_id === agentId;
    if (!isInitiator && !isResponder) throw new Error('Agent is not a session participant');
    const owner = isInitiator ? row.initiator_operator_id : row.responder_operator_id;
    if (owner !== operatorId) throw new Error('Agent is not owned by this account');
    const interaction = FederatedInteractionSchema.parse(row.payload);
    const peerAgentId = String(isInitiator ? row.responder_agent_id : row.initiator_agent_id);
    const peer = await this.sessionParticipant(peerAgentId);
    const privateContext = await this.privateCounterpartyInsights(
      String(owner),
      peer,
      interaction.contract.taskCategory,
    );
    const briefRows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${String(owner)}
        AND kind = 'counterparty_brief'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'recipientAgentId' = ${agentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const storedBrief = CounterpartyBriefSchema.safeParse(briefRows[0]?.payload);
    const counterpartyBrief = storedBrief.success
      ? storedBrief.data
      : buildCounterpartyBrief({
          interactionId,
          contractHash: interaction.termsHash,
          contract: interaction.contract,
          recipientAgentId: agentId,
          subject: peer.card,
          historyInsights: privateContext.insights,
          relevantSampleSize: privateContext.relevantSampleSize,
          historyConfidence: privateContext.historyConfidence,
          expiresAt: new Date(String(row.expires_at)).toISOString(),
        });
    const bearerToken = this.sessionGrant(interaction, agentId, peerAgentId);
    return {
      type: 'openclasp.session.activation' as const,
      version: '1' as const,
      activationId: crypto.randomUUID(),
      interactionId,
      agentId,
      sessionId: String(isInitiator ? row.initiator_session_id : row.responder_session_id),
      role: isInitiator ? ('initiator' as const) : ('responder' as const),
      peer: {
        agentId: peerAgentId,
        sessionId: String(isInitiator ? row.responder_session_id : row.initiator_session_id),
        endpoint: String(isInitiator ? row.responder_endpoint : row.initiator_endpoint),
        bearerToken,
        verificationKey: getSessionVerificationKey(this.gatewaySecret()),
      },
      reporting: {
        endpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/events`,
        completionEndpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/completion-reports`,
        feedbackEndpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/feedback`,
        bearerToken,
      },
      privateInsights: privateContext.insights,
      counterpartyBrief,
      contractHash: interaction.termsHash,
      activatedAt: row.activated_at
        ? new Date(String(row.activated_at)).toISOString()
        : new Date().toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
  }

  private async interactionParticipant(operatorId: string, interactionId: string, agentId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
        AND (
          (initiator_operator_id = ${operatorId} AND initiator_agent_id = ${agentId})
          OR (responder_operator_id = ${operatorId} AND responder_agent_id = ${agentId})
        )
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction participant not found for this account');
    const interaction = FederatedInteractionSchema.parse(row.payload);
    const isInitiator = interaction.initiatorAgentId === agentId;
    return {
      interaction,
      counterpartyAgentId: isInitiator
        ? interaction.responderAgentId
        : interaction.initiatorAgentId,
      participantOperatorId: String(
        isInitiator ? row.initiator_operator_id : row.responder_operator_id,
      ),
      counterpartyOperatorId: String(
        isInitiator ? row.responder_operator_id : row.initiator_operator_id,
      ),
    };
  }

  async getCounterpartyBrief(operatorId: string, interactionId: string, agentId: string) {
    await this.interactionParticipant(operatorId, interactionId, agentId);
    const rows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'counterparty_brief'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'recipientAgentId' = ${agentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const parsed = CounterpartyBriefSchema.safeParse(rows[0]?.payload);
    if (!parsed.success) throw new Error('Counterparty brief is not available');
    return parsed.data;
  }

  private async ensureFeedbackRequest(
    operatorId: string,
    interactionId: string,
    reviewerAgentId: string,
    subjectAgentId: string,
  ) {
    const existing = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'reviewerAgentId' = ${reviewerAgentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const parsed = FeedbackRequestSchema.safeParse(existing[0]?.payload);
    if (parsed.success) return parsed.data;
    const requestedAt = new Date();
    const base = FeedbackRequestSchema.parse({
      requestId: deterministicUuid(`feedback-request:${interactionId}:${reviewerAgentId}`),
      interactionId,
      reviewerAgentId,
      subjectAgentId,
      status: 'pending',
      requestedDimensions: FEEDBACK_DIMENSIONS,
      requestedAt: requestedAt.toISOString(),
      dueAt: new Date(requestedAt.getTime() + feedbackWindowMilliseconds()).toISOString(),
    });
    const request = FeedbackRequestSchema.parse({
      ...base,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), base),
    });
    await this.upsert(operatorId, 'feedback_request', request.requestId, request);
    return request;
  }

  private async requestRuntimeFinalization(
    interactionId: string,
    reportingAgentId: string,
    counterpartyAgentId: string,
    contractHash: string,
  ) {
    const rows = await this.sql`
      SELECT endpoint FROM openclasp_agent_runtimes
      WHERE agent_id = ${counterpartyAgentId} AND status = 'verified'
      LIMIT 1
    `;
    if (!rows[0]?.endpoint) return false;
    const requestId = crypto.randomUUID();
    const value = {
      type: 'openclasp.session.finalization_request',
      version: '1',
      requestId,
      interactionId,
      agentId: counterpartyAgentId,
      peerAgentId: reportingAgentId,
      contractHash,
      requestedAt: new Date().toISOString(),
    };
    const response = await this.signedRuntimeRequest(
      { callbackEndpoint: String(rows[0].endpoint) },
      requestId,
      value,
    );
    return response.status >= 200 && response.status < 300;
  }

  async listFeedbackRequests(operatorId: string, agentId: string) {
    const rows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND payload->>'reviewerAgentId' = ${agentId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => FeedbackRequestSchema.parse(row.payload));
  }

  async submitCompletionReport(
    operatorId: string,
    agentId: string,
    value: InteractionCompletionReport,
    submissionMethod:
      'oauth_account' | 'oauth_installation' | 'agent_access_token' | 'runtime_session',
  ) {
    const participant = await this.interactionParticipant(operatorId, value.interactionId, agentId);
    const report = InteractionCompletionReportSchema.parse(value);
    if (report.platformAttestation)
      throw new Error('Platform attestation is assigned by OpenClasp');
    if (report.reportingAgentId !== agentId)
      throw new Error('Completion report identity does not match the authenticated agent');
    if (report.counterpartyAgentId !== participant.counterpartyAgentId)
      throw new Error('Completion report counterparty does not match the interaction');
    if (report.contractHash !== participant.interaction.termsHash)
      throw new Error('Completion report contract hash does not match the interaction');
    if (report.requestedOutcome !== participant.interaction.contract.requestedOutcome)
      throw new Error('Completion report requested outcome does not match the contract');
    if (
      report.criteria.some(
        (criterion) =>
          !participant.interaction.contract.successCriteria.includes(criterion.criterion),
      )
    )
      throw new Error('Completion report contains a criterion outside the contract');
    if (!['active', 'completed'].includes(participant.interaction.status))
      throw new Error('Only active or completed interactions accept completion reports');
    const profiles = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const profile = profiles[0]?.payload as Partial<AgentProfile> | undefined;
    if (!profile || profile.agentVersion !== report.agentVersion)
      throw new Error('Completion report agent version does not match the registered agent');
    let verifiedSubmissionMethod: InteractionCompletionReport['submissionMethod'] =
      submissionMethod;
    if (report.signature) {
      if (report.submissionMethod !== 'agent_signature')
        throw new Error('Signed completion reports must declare agent_signature submission');
      const identities = await this.sql`
        SELECT payload FROM openclasp_records
        WHERE operator_id = ${operatorId} AND kind = 'agent' AND record_id = ${agentId}
        LIMIT 1
      `;
      const identity = AgentIdentitySchema.safeParse(identities[0]?.payload);
      if (
        !identity.success ||
        !verifyObject(report as unknown as Record<string, unknown>, identity.data.publicKey)
      )
        throw new Error('Completion report agent signature is invalid or unverifiable');
      verifiedSubmissionMethod = 'agent_signature';
    }
    const unsigned = InteractionCompletionReportSchema.parse({
      ...report,
      submissionMethod: verifiedSubmissionMethod,
    });
    const stored = InteractionCompletionReportSchema.parse({
      ...unsigned,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), unsigned),
    });
    const existing = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE kind = 'completion_report' AND record_id = ${stored.reportId}
        AND payload->>'interactionId' = ${stored.interactionId}
      LIMIT 1
    `;
    if (existing[0] && canonicalHash(existing[0].payload) !== canonicalHash(stored))
      throw new Error('Conflicting completion report ID');
    await Promise.all([
      this.upsert(participant.participantOperatorId, 'completion_report', stored.reportId, stored),
      this.upsert(participant.counterpartyOperatorId, 'completion_report', stored.reportId, stored),
    ]);
    const [feedbackRequest] = await Promise.all([
      this.ensureFeedbackRequest(
        participant.participantOperatorId,
        stored.interactionId,
        stored.reportingAgentId,
        stored.counterpartyAgentId,
      ),
      this.ensureFeedbackRequest(
        participant.counterpartyOperatorId,
        stored.interactionId,
        stored.counterpartyAgentId,
        stored.reportingAgentId,
      ),
    ]);
    const completed = await this.sql`
      SELECT COUNT(DISTINCT payload->>'reportingAgentId') AS count
      FROM openclasp_records
      WHERE kind = 'completion_report'
        AND payload->>'interactionId' = ${stored.interactionId}
    `;
    let peerReportStatus: InteractionConclusion['peerReportStatus'] = 'received';
    if (Number(completed[0]?.count ?? 0) >= 2) {
      const completedAt = new Date().toISOString();
      await Promise.all([
        this.sql`
          UPDATE openclasp_live_sessions SET status = 'completed', completed_at = NOW()
          WHERE interaction_id = ${stored.interactionId} AND status = 'active'
        `,
        this.sql`
          UPDATE openclasp_federated_interactions
          SET status = 'completed',
            payload = jsonb_set(
              jsonb_set(payload, '{status}', '"completed"'::jsonb),
              '{updatedAt}', to_jsonb(${completedAt}::text)
            ),
            updated_at = NOW()
          WHERE interaction_id = ${stored.interactionId} AND status = 'active'
        `,
      ]);
      await Promise.all([
        this.journalLiveSessionState(stored.interactionId),
        this.journalFederatedInteraction(stored.interactionId),
      ]);
    } else {
      const requested = await this.requestRuntimeFinalization(
        stored.interactionId,
        stored.reportingAgentId,
        stored.counterpartyAgentId,
        stored.contractHash,
      ).catch(() => false);
      peerReportStatus = requested ? 'awaiting' : 'unreachable';
    }
    const conclusion = await this.finalizeInteractionConclusion(stored.interactionId, {
      peerReportStatus,
    });
    return {
      report: stored,
      feedbackRequest,
      peerReportRequested: peerReportStatus === 'awaiting',
      ...(conclusion.released ? { conclusion: conclusion.conclusion } : {}),
    };
  }

  async recordSessionCompletionReport(token: string, value: InteractionCompletionReport) {
    const report = InteractionCompletionReportSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (
      grant.interactionId !== report.interactionId ||
      grant.senderAgentId !== report.reportingAgentId ||
      grant.recipientAgentId !== report.counterpartyAgentId
    )
      throw new Error('Session credential does not match the completion report');
    const owners = await this.sql`
      SELECT initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${report.interactionId}
      LIMIT 1
    `;
    const row = owners[0];
    if (!row) throw new Error('Interaction not found');
    const operatorId = String(
      row.initiator_agent_id === report.reportingAgentId
        ? row.initiator_operator_id
        : row.responder_operator_id,
    );
    return this.submitCompletionReport(
      operatorId,
      report.reportingAgentId,
      report,
      'runtime_session',
    );
  }

  private async applyInteractionLearning(input: {
    interaction: FederatedInteraction;
    initiatorOperatorId: string;
    responderOperatorId: string;
    reports: InteractionCompletionReport[];
    feedback: InteractionFeedback[];
    conclusion: InteractionConclusion;
  }) {
    const { interaction, reports, feedback, conclusion } = input;
    const [initiatorSettings, responderSettings, cards, pairActivity] = await Promise.all([
      this.getSettings(input.initiatorOperatorId),
      this.getSettings(input.responderOperatorId),
      this.sql`
        SELECT agent_id, card FROM openclasp_public_agents
        WHERE agent_id IN (${interaction.initiatorAgentId}, ${interaction.responderAgentId})
      `,
      this.sql`
        SELECT COUNT(*)::integer AS count
        FROM openclasp_federated_interactions
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND (
            (initiator_agent_id = ${interaction.initiatorAgentId}
              AND responder_agent_id = ${interaction.responderAgentId})
            OR
            (initiator_agent_id = ${interaction.responderAgentId}
              AND responder_agent_id = ${interaction.initiatorAgentId})
          )
      `,
    ]);
    const contributionMode =
      initiatorSettings.contributionEnabled && responderSettings.contributionEnabled
        ? ('network_aggregate' as const)
        : ('local_only' as const);
    const eligibilityBase = evaluateLearningEligibility({
      interactionId: interaction.interactionId,
      reports,
      feedback,
      consensus: conclusion.consensus,
      contributionMode,
      reviewerCredibility: Object.fromEntries(
        feedback.map((item) => [item.reviewerAgentId, reviewerCredibility(item)]),
      ),
      manipulationSignals: [
        ...(input.initiatorOperatorId === input.responderOperatorId ? ['same_operator_pair'] : []),
        ...(Number(pairActivity[0]?.count ?? 0) > 10 ? ['rapid_reciprocal_pair_activity'] : []),
      ],
      decisionId: deterministicUuid(`learning-eligibility:${interaction.interactionId}`),
      decidedAt: conclusion.generatedAt,
    });
    const eligibility = LearningEligibilityDecisionSchema.parse({
      ...eligibilityBase,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), eligibilityBase),
    });
    await Promise.all([
      this.upsert(
        input.initiatorOperatorId,
        'learning_eligibility',
        eligibility.decisionId,
        eligibility,
      ),
      this.upsert(
        input.responderOperatorId,
        'learning_eligibility',
        eligibility.decisionId,
        eligibility,
      ),
    ]);
    if (!eligibility.eligible || eligibility.sampleWeight <= 0)
      return { eligibility, profileDeltas: [] as BehaviouralProfileDelta[] };

    const appliedAt = new Date().toISOString();
    const versions = new Map<string, string>();
    for (const report of reports) versions.set(report.reportingAgentId, report.agentVersion);
    for (const row of cards) {
      const card = PublicAgentCardSchema.safeParse(row.card);
      if (card.success && !versions.has(String(row.agent_id)))
        versions.set(String(row.agent_id), card.data.agentVersion);
    }
    const participants = [
      {
        viewerOperatorId: input.initiatorOperatorId,
        reviewerAgentId: interaction.initiatorAgentId,
        subjectAgentId: interaction.responderAgentId,
      },
      {
        viewerOperatorId: input.responderOperatorId,
        reviewerAgentId: interaction.responderAgentId,
        subjectAgentId: interaction.initiatorAgentId,
      },
      {
        viewerOperatorId: input.initiatorOperatorId,
        reviewerAgentId: interaction.responderAgentId,
        subjectAgentId: interaction.initiatorAgentId,
      },
      {
        viewerOperatorId: input.responderOperatorId,
        reviewerAgentId: interaction.initiatorAgentId,
        subjectAgentId: interaction.responderAgentId,
      },
    ];
    const profileDeltas: Array<BehaviouralProfileDelta | undefined> = [];
    for (const participant of participants) {
      const agentVersion = versions.get(participant.subjectAgentId);
      if (!agentVersion) {
        profileDeltas.push(undefined);
        continue;
      }
      const deltaId = deterministicUuid(
        `profile-delta:${interaction.interactionId}:${participant.viewerOperatorId}:${participant.reviewerAgentId}:${participant.subjectAgentId}`,
      );
      const legacyDeltaId = deterministicUuid(
        `profile-delta:${interaction.interactionId}:${participant.viewerOperatorId}:${participant.subjectAgentId}`,
      );
      const existingDelta = await this.sql`
          SELECT payload FROM openclasp_records
          WHERE operator_id = ${participant.viewerOperatorId}
            AND kind = 'profile_delta'
            AND (record_id = ${deltaId} OR record_id = ${legacyDeltaId})
          LIMIT 1
        `;
      const parsedDelta = BehaviouralProfileDeltaSchema.safeParse(existingDelta[0]?.payload);
      if (parsedDelta.success) {
        profileDeltas.push(parsedDelta.data);
        continue;
      }
      const profileId = deterministicUuid(
        `contextual-profile:${participant.subjectAgentId}:${agentVersion}:${interaction.contract.taskCategory}`,
      );
      const currentRows = await this.sql`
          SELECT payload FROM openclasp_records
          WHERE operator_id = ${participant.viewerOperatorId}
            AND kind = 'profile' AND record_id = ${profileId}
          LIMIT 1
        `;
      const current = currentRows[0]?.payload as Partial<ContextualProfile> | undefined;
      const reviewerFeedback = feedback.find(
        (item) =>
          item.reviewerAgentId === participant.reviewerAgentId &&
          item.subjectAgentId === participant.subjectAgentId,
      );
      const observations = deriveBehaviouralObservations({
        subjectAgentId: participant.subjectAgentId,
        reviewerAgentId: participant.reviewerAgentId,
        reports,
        ...(reviewerFeedback ? { reviewerFeedback } : {}),
        conclusion,
      });
      if (!Object.keys(observations).length) {
        profileDeltas.push(undefined);
        continue;
      }
      const applied = updateContextualBehaviouralProfile({
        ...(current ? { current } : {}),
        observations,
        sampleWeight: eligibility.sampleWeight,
        appliedAt,
      });
      const profile: ContextualProfile = {
        recordId: profileId,
        agentId: participant.subjectAgentId,
        agentVersion,
        taskCategory: interaction.contract.taskCategory,
        ...applied.profile,
      };
      const deltaBase = BehaviouralProfileDeltaSchema.parse({
        deltaId,
        interactionId: interaction.interactionId,
        agentId: participant.subjectAgentId,
        agentVersion,
        taskCategory: interaction.contract.taskCategory,
        sampleWeight: eligibility.sampleWeight,
        dimensionDeltas: applied.dimensionDeltas,
        explanation:
          'Applied platform-attested structured outcome and eligible reviewer signals; private comments and raw conversation content were excluded.',
        appliedAt,
      });
      const delta = BehaviouralProfileDeltaSchema.parse({
        ...deltaBase,
        platformAttestation: attestSessionRecord(this.gatewaySecret(), deltaBase),
      });
      await Promise.all([
        this.upsert(participant.viewerOperatorId, 'profile', profileId, profile),
        this.upsert(participant.viewerOperatorId, 'profile_delta', deltaId, delta),
      ]);
      profileDeltas.push(delta);
    }
    return {
      eligibility,
      profileDeltas: profileDeltas.filter(
        (delta): delta is BehaviouralProfileDelta => delta !== undefined,
      ),
    };
  }

  private async finalizeInteractionConclusion(
    interactionId: string,
    options: { peerReportStatus?: InteractionConclusion['peerReportStatus'] } = {},
  ) {
    const [interactionRows, reportRows, feedbackRows, requestRows, existingRows] =
      await Promise.all([
        this.sql`
        SELECT payload, initiator_operator_id, responder_operator_id
        FROM openclasp_federated_interactions
        WHERE interaction_id = ${interactionId}
        LIMIT 1
      `,
        this.sql`
        SELECT record_id, payload FROM openclasp_records
        WHERE kind = 'completion_report' AND payload->>'interactionId' = ${interactionId}
      `,
        this.sql`
        SELECT record_id, payload FROM openclasp_records
        WHERE kind = 'interaction_feedback' AND payload->>'interactionId' = ${interactionId}
      `,
        this.sql`
        SELECT record_id, payload FROM openclasp_records
        WHERE kind = 'feedback_request' AND payload->>'interactionId' = ${interactionId}
      `,
        this.sql`
        SELECT payload FROM openclasp_records
        WHERE kind = 'interaction_conclusion' AND payload->>'interactionId' = ${interactionId}
        LIMIT 1
      `,
      ]);
    const interactionRow = interactionRows[0];
    if (!interactionRow) throw new Error('Interaction not found');
    const interaction = FederatedInteractionSchema.parse(interactionRow.payload);
    const reports = [
      ...new Map(
        reportRows
          .map((row) => InteractionCompletionReportSchema.parse(row.payload))
          .map((report) => [report.reportId, report]),
      ).values(),
    ];
    const feedback = [
      ...new Map(
        feedbackRows
          .map((row) => InteractionFeedbackSchema.parse(row.payload))
          .map((item) => [item.feedbackId, item]),
      ).values(),
    ];
    const requests = [
      ...new Map(
        requestRows
          .map((row) => FeedbackRequestSchema.parse(row.payload))
          .map((request) => [request.requestId, request]),
      ).values(),
    ];
    if (!reports.length) return { released: false as const, feedbackRevealed: false as const };
    const existing = InteractionConclusionSchema.safeParse(existingRows[0]?.payload);
    const reportingAgentIds = new Set(reports.map((report) => report.reportingAgentId));
    const missingReportAgentIds = [
      interaction.initiatorAgentId,
      interaction.responderAgentId,
    ].filter((agentId) => !reportingAgentIds.has(agentId));
    const feedbackWindowClosed =
      requests.length >= 2 && requests.every((request) => request.status !== 'pending');
    const lifecycle =
      missingReportAgentIds.length === 0 || feedbackWindowClosed
        ? ('final' as const)
        : ('provisional' as const);
    const visibleFeedback = feedbackWindowClosed ? feedback : [];
    const peerReportStatus: InteractionConclusion['peerReportStatus'] =
      missingReportAgentIds.length === 0
        ? 'received'
        : feedbackWindowClosed
          ? 'timed_out'
          : (options.peerReportStatus ?? existing.data?.peerReportStatus ?? 'awaiting');
    const pendingFeedbackAgentIds = requests
      .filter((request) => request.status === 'pending')
      .map((request) => request.reviewerAgentId);
    if (requests.length < 2) return { released: false as const };
    const base = buildInteractionConclusion({
      interaction,
      reports,
      feedback: visibleFeedback,
      conclusionId: deterministicUuid(`interaction-conclusion:${interactionId}`),
      lifecycle,
      pendingFeedbackAgentIds,
      peerReportStatus,
    });
    const conclusion = InteractionConclusionSchema.parse({
      ...base,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), base),
    });
    const startedAt = reports
      .map((report) => report.startedAt)
      .filter((value): value is string => typeof value === 'string')
      .sort()[0];
    const receiptBase = {
      receiptId: deterministicUuid(`interaction-receipt:${interactionId}`),
      interactionId,
      participants: [interaction.initiatorAgentId, interaction.responderAgentId],
      agentVersions: Object.fromEntries(
        reports.map((report) => [report.reportingAgentId, report.agentVersion]),
      ),
      contractHash: interaction.termsHash,
      startedAt: startedAt ?? interaction.createdAt,
      completedAt:
        reports
          .map((report) => report.completedAt)
          .sort()
          .at(-1) ?? conclusion.generatedAt,
      outcome: conclusion.outcome,
      commitmentsFulfilled: conclusion.criteria
        .filter((criterion) => criterion.status === 'met')
        .map((criterion) => criterion.criterion),
      commitmentsMissed: conclusion.criteria
        .filter((criterion) => criterion.status !== 'met')
        .map((criterion) => criterion.criterion),
      evidenceHashes: conclusion.evidenceReferences.map((reference) => canonicalHash(reference)),
      policyWarnings: reports.flatMap((report) => report.blockers),
      policyViolations: [],
      disputeStatus: conclusion.consensus === 'conflicting' ? ('open' as const) : ('none' as const),
      delegationChainHash: canonicalHash(interaction.contract.delegationRules),
      unilateral: reports.length < 2,
      provisional: lifecycle === 'provisional',
      confidence: conclusion.confidence,
      signatures: {},
      completionReportIds: conclusion.reportIds,
      conclusionId: conclusion.conclusionId,
    };
    const receipt = ReceiptSchema.parse({
      ...receiptBase,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), receiptBase),
    });
    await Promise.all([
      this.upsert(
        String(interactionRow.initiator_operator_id),
        'interaction_conclusion',
        conclusion.conclusionId,
        conclusion,
      ),
      this.upsert(
        String(interactionRow.responder_operator_id),
        'interaction_conclusion',
        conclusion.conclusionId,
        conclusion,
      ),
      this.upsert(
        String(interactionRow.initiator_operator_id),
        'receipt',
        receipt.receiptId,
        receipt,
      ),
      this.upsert(
        String(interactionRow.responder_operator_id),
        'receipt',
        receipt.receiptId,
        receipt,
      ),
    ]);
    const learning =
      lifecycle === 'final' && feedbackWindowClosed
        ? await this.applyInteractionLearning({
            interaction,
            initiatorOperatorId: String(interactionRow.initiator_operator_id),
            responderOperatorId: String(interactionRow.responder_operator_id),
            reports,
            feedback: visibleFeedback,
            conclusion,
          })
        : undefined;
    return {
      released: true as const,
      feedbackRevealed: feedbackWindowClosed,
      conclusion,
      receipt,
      ...(learning ? { learning } : {}),
    };
  }

  async submitInteractionFeedback(
    operatorId: string,
    agentId: string,
    value: InteractionFeedback,
    submissionMethod:
      'oauth_account' | 'oauth_installation' | 'agent_access_token' | 'runtime_session',
  ) {
    const feedback = InteractionFeedbackSchema.parse(value);
    if (feedback.platformAttestation)
      throw new Error('Platform attestation is assigned by OpenClasp');
    if (feedback.reviewerAgentId !== agentId)
      throw new Error('Feedback reviewer does not match the authenticated agent');
    const participant = await this.interactionParticipant(
      operatorId,
      feedback.interactionId,
      agentId,
    );
    if (feedback.subjectAgentId !== participant.counterpartyAgentId)
      throw new Error('Feedback subject does not match the interaction counterparty');
    const requestRows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND record_id = ${feedback.requestId}
      LIMIT 1
    `;
    const request = FeedbackRequestSchema.parse(requestRows[0]?.payload);
    if (
      request.interactionId !== feedback.interactionId ||
      request.reviewerAgentId !== feedback.reviewerAgentId ||
      request.subjectAgentId !== feedback.subjectAgentId
    )
      throw new Error('Feedback does not match its request');
    if (request.status !== 'pending') throw new Error('Feedback request is no longer pending');
    if (Date.parse(request.dueAt) <= Date.now()) throw new Error('Feedback request has expired');
    if (
      request.requestedDimensions.some(
        (dimension) => typeof feedback.ratings[dimension] !== 'number',
      )
    )
      throw new Error('Feedback must rate every requested dimension');
    const profiles = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const profile = profiles[0]?.payload as Partial<AgentProfile> | undefined;
    if (!profile || profile.agentVersion !== feedback.reviewerAgentVersion)
      throw new Error('Feedback reviewer version does not match the registered agent');
    let verifiedSubmissionMethod: InteractionFeedback['submissionMethod'] = submissionMethod;
    if (feedback.signature) {
      if (feedback.submissionMethod !== 'agent_signature')
        throw new Error('Signed feedback must declare agent_signature submission');
      const identities = await this.sql`
        SELECT payload FROM openclasp_records
        WHERE operator_id = ${operatorId} AND kind = 'agent' AND record_id = ${agentId}
        LIMIT 1
      `;
      const identity = AgentIdentitySchema.safeParse(identities[0]?.payload);
      if (
        !identity.success ||
        !verifyObject(feedback as unknown as Record<string, unknown>, identity.data.publicKey)
      )
        throw new Error('Feedback agent signature is invalid or unverifiable');
      verifiedSubmissionMethod = 'agent_signature';
    }
    const unattested = InteractionFeedbackSchema.parse({
      ...feedback,
      submissionMethod: verifiedSubmissionMethod,
    });
    const stored = InteractionFeedbackSchema.parse({
      ...unattested,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), unattested),
    });
    const existing = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'interaction_feedback'
        AND record_id = ${stored.feedbackId}
      LIMIT 1
    `;
    if (existing[0] && canonicalHash(existing[0].payload) !== canonicalHash(stored))
      throw new Error('Conflicting feedback ID');
    await this.upsert(operatorId, 'interaction_feedback', stored.feedbackId, stored);
    const requestBase = { ...request, status: 'submitted' as const };
    delete requestBase.platformAttestation;
    const updatedRequest = FeedbackRequestSchema.parse({
      ...requestBase,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), requestBase),
    });
    await this.upsert(operatorId, 'feedback_request', request.requestId, updatedRequest);
    const release = await this.finalizeInteractionConclusion(feedback.interactionId);
    return {
      feedbackId: stored.feedbackId,
      status: 'submitted' as const,
      revealed: release.released && release.feedbackRevealed,
      ...(release.released ? { conclusion: release.conclusion } : {}),
    };
  }

  async processDueFeedback(now = new Date()) {
    await this.ensureSchema();
    const expiredInteractions = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = 'expired',
        payload = jsonb_set(
          jsonb_set(payload, '{status}', '"expired"'::jsonb),
          '{updatedAt}', to_jsonb(${now.toISOString()}::text)
        ),
        updated_at = NOW()
      WHERE status IN ('pending', 'active') AND expires_at <= ${now.toISOString()}
      RETURNING interaction_id
    `;
    if (expiredInteractions.length) {
      await this.sql`
        UPDATE openclasp_live_sessions
        SET status = 'failed', completed_at = COALESCE(completed_at, NOW()),
          last_error = COALESCE(last_error, 'Interaction expired before bilateral completion')
        WHERE status IN ('preparing', 'active')
          AND interaction_id IN (
            SELECT interaction_id FROM openclasp_federated_interactions
            WHERE status = 'expired' AND expires_at <= ${now.toISOString()}
          )
      `;
      await Promise.all(
        expiredInteractions.flatMap((row) => {
          const interactionId = String(row.interaction_id);
          return [
            this.journalFederatedInteraction(interactionId),
            this.journalLiveSessionState(interactionId),
          ];
        }),
      );
    }
    const [rows, backfillRows] = await Promise.all([
      this.sql`
        SELECT operator_id, record_id, payload FROM openclasp_records
        WHERE kind = 'feedback_request'
          AND payload->>'status' = 'pending'
          AND (payload->>'dueAt')::timestamptz <= ${now.toISOString()}
        LIMIT 500
      `,
      this.sql`
        SELECT source.interaction_id
        FROM (
          SELECT conclusion.payload->>'interactionId' AS interaction_id
          FROM openclasp_records conclusion
          WHERE conclusion.kind = 'interaction_conclusion'
            AND NOT EXISTS (
              SELECT 1 FROM openclasp_records eligibility
              WHERE eligibility.operator_id = conclusion.operator_id
                AND eligibility.kind = 'learning_eligibility'
                AND eligibility.payload->>'interactionId' = conclusion.payload->>'interactionId'
            )
          UNION
          SELECT report.payload->>'interactionId' AS interaction_id
          FROM openclasp_records report
          WHERE report.kind = 'completion_report'
            AND NOT EXISTS (
              SELECT 1 FROM openclasp_records conclusion
              WHERE conclusion.kind = 'interaction_conclusion'
                AND conclusion.payload->>'interactionId' = report.payload->>'interactionId'
            )
        ) source
        WHERE source.interaction_id IS NOT NULL
        GROUP BY source.interaction_id
        ORDER BY source.interaction_id ASC
        LIMIT 200
      `,
    ]);
    const interactions = new Set<string>();
    for (const row of rows) {
      const request = FeedbackRequestSchema.parse(row.payload);
      const base = { ...request, status: 'expired' as const };
      delete base.platformAttestation;
      const expired = FeedbackRequestSchema.parse({
        ...base,
        platformAttestation: attestSessionRecord(this.gatewaySecret(), base),
      });
      await this.upsert(
        String(row.operator_id),
        'feedback_request',
        String(row.record_id),
        expired,
      );
      interactions.add(request.interactionId);
    }
    for (const row of backfillRows) interactions.add(String(row.interaction_id));
    let released = 0;
    for (const interactionId of interactions) {
      const result = await this.finalizeInteractionConclusion(interactionId);
      if (result.released) released += 1;
    }
    return {
      expired: rows.length,
      interactionsExpired: expiredInteractions.length,
      released,
      backfilled: backfillRows.length,
    };
  }

  async recordSessionFeedback(token: string, value: InteractionFeedback) {
    const feedback = InteractionFeedbackSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (
      grant.interactionId !== feedback.interactionId ||
      grant.senderAgentId !== feedback.reviewerAgentId ||
      grant.recipientAgentId !== feedback.subjectAgentId
    )
      throw new Error('Session credential does not match the feedback');
    const owners = await this.sql`
      SELECT initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${feedback.interactionId}
      LIMIT 1
    `;
    const row = owners[0];
    if (!row) throw new Error('Interaction not found');
    const operatorId = String(
      row.initiator_agent_id === feedback.reviewerAgentId
        ? row.initiator_operator_id
        : row.responder_operator_id,
    );
    return this.submitInteractionFeedback(
      operatorId,
      feedback.reviewerAgentId,
      feedback,
      'runtime_session',
    );
  }

  private async ownedTemporaryAgent(operatorId: string, agentId: string) {
    const rows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const profile = rows[0]?.payload as Partial<AgentProfile> | undefined;
    if (!profile) throw new Error('Agent is not owned by this account');
    const mode =
      profile.agentMode ?? (profile.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat');
    if (mode !== 'temporary_chat')
      throw new Error('Hosted conversations are available only to temporary chat agents');
    return profile;
  }

  private hostedMessage(row: Record<string, any>): HostedMessage {
    const decrypted = this.decryptGatewayPayload({
      ciphertext: String(row.content_ciphertext),
      iv: String(row.content_iv),
      authTag: String(row.content_auth_tag),
    }) as { content?: unknown };
    return HostedMessageSchema.parse({
      messageId: String(row.message_id),
      threadId: String(row.thread_id),
      interactionId: String(row.interaction_id),
      senderAgentId: String(row.sender_agent_id),
      recipientAgentId: String(row.recipient_agent_id),
      contentType: 'text/plain',
      content: decrypted.content,
      contentHash: String(row.content_hash),
      delivery: row.delivery,
      createdAt: new Date(String(row.created_at)).toISOString(),
      ...(row.read_at ? { readAt: new Date(String(row.read_at)).toISOString() } : {}),
    });
  }

  private async storeHostedMessage(input: {
    interactionId: string;
    senderAgentId: string;
    recipientAgentId: string;
    requestKey: string;
    content: string;
    delivery: 'accepted' | 'delivered';
  }) {
    const content = input.content.trim();
    if (!content || content.length > 20_000)
      throw new Error('Message must contain 1-20000 characters');
    const sessions = await this.sql`
      SELECT session.status, interaction.status AS interaction_status,
        session.initiator_agent_id, session.responder_agent_id
      FROM openclasp_live_sessions session
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id = session.interaction_id
      WHERE session.interaction_id = ${input.interactionId}
      LIMIT 1
    `;
    const session = sessions[0];
    if (!session || session.status !== 'active' || session.interaction_status !== 'active')
      throw new Error('Active interaction not found');
    const participants = new Set([
      String(session.initiator_agent_id),
      String(session.responder_agent_id),
    ]);
    if (!participants.has(input.senderAgentId) || !participants.has(input.recipientAgentId))
      throw new Error('Message participants do not match the active interaction');
    const now = new Date();
    const threadId = input.interactionId;
    const expiresAt = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    await this.sql`
      INSERT INTO openclasp_hosted_threads(
        thread_id, interaction_id, participant_a_agent_id, participant_b_agent_id,
        status, expires_at
      ) VALUES (
        ${threadId}, ${input.interactionId}, ${String(session.initiator_agent_id)},
        ${String(session.responder_agent_id)}, 'open', ${expiresAt}
      )
      ON CONFLICT (thread_id) DO UPDATE SET updated_at = NOW()
      WHERE openclasp_hosted_threads.status = 'open'
    `;
    const thread = await this.sql`
      SELECT status, expires_at FROM openclasp_hosted_threads WHERE thread_id = ${threadId}
    `;
    if (thread[0]?.status !== 'open') throw new Error('Hosted thread is closed');
    if (Date.parse(String(thread[0].expires_at)) <= Date.now())
      throw new Error('Hosted thread has expired');
    const encrypted = encryptGatewayPayload(this.gatewaySecret(), { content });
    const messageId = crypto.randomUUID();
    const contentHash = canonicalHash(content);
    const inserted = await this.sql`
      INSERT INTO openclasp_hosted_messages(
        message_id, thread_id, interaction_id, sender_agent_id, recipient_agent_id,
        request_key, content_ciphertext, content_iv, content_auth_tag, content_hash, delivery
      ) VALUES (
        ${messageId}, ${threadId}, ${input.interactionId}, ${input.senderAgentId},
        ${input.recipientAgentId}, ${input.requestKey}, ${encrypted.ciphertext}, ${encrypted.iv},
        ${encrypted.authTag}, ${contentHash}, ${input.delivery}
      )
      ON CONFLICT (thread_id, sender_agent_id, request_key) DO NOTHING
      RETURNING *
    `;
    if (!inserted[0]) {
      const existing = await this.sql`
        SELECT * FROM openclasp_hosted_messages
        WHERE thread_id = ${threadId} AND sender_agent_id = ${input.senderAgentId}
          AND request_key = ${input.requestKey}
        LIMIT 1
      `;
      return { message: this.hostedMessage(existing[0]!), deduplicated: true };
    }
    const sequenceRows = await this.sql`
      SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence
      FROM openclasp_live_session_events
      WHERE interaction_id = ${input.interactionId} AND agent_id = ${input.senderAgentId}
    `;
    const event = LiveSessionEventSchema.parse({
      eventId: crypto.randomUUID(),
      interactionId: input.interactionId,
      agentId: input.senderAgentId,
      sequence: Number(sequenceRows[0]?.sequence ?? 0),
      type: 'message_sent',
      occurredAt: now.toISOString(),
      messageHash: contentHash,
      evidenceReferences: [],
      details: { labels: ['hosted_temporary'], metrics: {}, flags: { rawStoredEncrypted: true } },
    });
    const eventWithAttestation = JSON.stringify({
      ...event,
      attestation: attestSessionRecord(this.gatewaySecret(), event),
    });
    await this.sql`
      INSERT INTO openclasp_live_session_events(interaction_id, event_id, agent_id, sequence, event)
      VALUES (${event.interactionId}, ${event.eventId}, ${event.agentId}, ${event.sequence}, ${eventWithAttestation}::jsonb)
      ON CONFLICT DO NOTHING
    `;
    await this.journalLiveSessionEvent(JSON.parse(eventWithAttestation) as Record<string, unknown>);
    return { message: this.hostedMessage(inserted[0]), deduplicated: false };
  }

  async receiveTemporaryMessage(
    token: string,
    recipientAgentId: string,
    requestKey: string,
    content: string,
  ) {
    await this.ensureSchema();
    const grant = this.verifySessionGrant(token);
    if (grant.recipientAgentId !== recipientAgentId)
      throw new Error('Session credential is not valid for this temporary agent');
    const recipient = await this.sessionParticipant(recipientAgentId);
    if (recipient.mode !== 'temporary_chat')
      throw new Error('Target is not a temporary chat agent');
    const stored = await this.storeHostedMessage({
      interactionId: grant.interactionId,
      senderAgentId: grant.senderAgentId,
      recipientAgentId,
      requestKey,
      content,
      delivery: 'delivered',
    });
    return stored;
  }

  async sendTemporaryMessage(
    operatorId: string,
    senderAgentId: string,
    interactionId: string,
    content: string,
  ) {
    await this.ensureSchema();
    await this.ownedTemporaryAgent(operatorId, senderAgentId);
    const session = await this.getLiveSession(operatorId, interactionId, senderAgentId);
    const peer = await this.sessionParticipant(session.peer.agentId);
    if (peer.mode !== 'persistent_runtime')
      throw new Error('Temporary-to-temporary hosted conversations are not supported');
    const requestKey = crypto.randomUUID();
    const stored = await this.storeHostedMessage({
      interactionId,
      senderAgentId,
      recipientAgentId: session.peer.agentId,
      requestKey,
      content,
      delivery: 'accepted',
    });
    const response = await postRuntimeJson(
      session.peer.endpoint,
      {
        jsonrpc: '2.0',
        id: requestKey,
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: content.trim() }],
            metadata: {
              [DEFAULT_EXTENSION_URI]: {
                interactionId,
                termsHash: session.contractHash,
                initiatorAgentId:
                  session.role === 'initiator' ? senderAgentId : session.peer.agentId,
                responderAgentId:
                  session.role === 'responder' ? senderAgentId : session.peer.agentId,
              },
            },
          },
        },
      },
      {
        authorization: `Bearer ${session.peer.bearerToken}`,
        'A2A-Extensions': DEFAULT_EXTENSION_URI,
      },
    );
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Peer A2A endpoint returned HTTP ${response.status}`);
    await this.sql`
      UPDATE openclasp_hosted_messages SET delivery = 'delivered'
      WHERE message_id = ${stored.message.messageId}
    `;
    return {
      ...stored,
      message: { ...stored.message, delivery: 'delivered' as const },
      peerResponse: response.body,
    };
  }

  async listHostedThreads(operatorId: string, agentId: string): Promise<HostedThread[]> {
    await this.ensureSchema();
    await this.ownedTemporaryAgent(operatorId, agentId);
    await this.sql`DELETE FROM openclasp_hosted_threads WHERE expires_at <= NOW()`;
    const rows = await this.sql`
      SELECT thread.*,
        (SELECT COUNT(*) FROM openclasp_hosted_messages message
          WHERE message.thread_id = thread.thread_id
            AND message.recipient_agent_id = ${agentId} AND message.read_at IS NULL) AS unread_count
      FROM openclasp_hosted_threads thread
      WHERE ${agentId} IN (thread.participant_a_agent_id, thread.participant_b_agent_id)
      ORDER BY thread.updated_at DESC
    `;
    return rows.map((row) =>
      HostedThreadSchema.parse({
        threadId: String(row.thread_id),
        interactionId: String(row.interaction_id),
        participantAgentIds: [
          String(row.participant_a_agent_id),
          String(row.participant_b_agent_id),
        ],
        status: row.status,
        privacyMode: 'openclasp_hosted_temporary',
        unreadCount: Number(row.unread_count ?? 0),
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
        expiresAt: new Date(String(row.expires_at)).toISOString(),
      }),
    );
  }

  async getHostedThread(operatorId: string, agentId: string, threadId: string) {
    const threads = await this.listHostedThreads(operatorId, agentId);
    const thread = threads.find((value) => value.threadId === threadId);
    if (!thread) throw new Error('Hosted thread not found');
    const rows = await this.sql`
      SELECT * FROM openclasp_hosted_messages
      WHERE thread_id = ${threadId} ORDER BY created_at ASC
    `;
    const peerAgentId = thread.participantAgentIds.find((value) => value !== agentId);
    if (!peerAgentId) throw new Error('Hosted thread has invalid participants');
    const peer = await this.sessionParticipant(peerAgentId);
    const interactions = await this.sql`
      SELECT payload FROM openclasp_federated_interactions
      WHERE interaction_id = ${thread.interactionId} LIMIT 1
    `;
    const interaction = FederatedInteractionSchema.parse(interactions[0]?.payload);
    const insights = await this.privateCounterpartyInsights(
      operatorId,
      peer,
      interaction.contract.taskCategory,
    );
    return { thread, messages: rows.map((row) => this.hostedMessage(row)), insights };
  }

  async markHostedThreadRead(operatorId: string, agentId: string, threadId: string) {
    await this.getHostedThread(operatorId, agentId, threadId);
    const rows = await this.sql`
      UPDATE openclasp_hosted_messages
      SET delivery = 'read', read_at = COALESCE(read_at, NOW())
      WHERE thread_id = ${threadId} AND recipient_agent_id = ${agentId} AND read_at IS NULL
      RETURNING message_id
    `;
    return { threadId, markedRead: rows.length };
  }

  async closeHostedThread(operatorId: string, agentId: string, threadId: string) {
    await this.getHostedThread(operatorId, agentId, threadId);
    await this.sql`
      UPDATE openclasp_hosted_threads SET status = 'closed', updated_at = NOW()
      WHERE thread_id = ${threadId}
    `;
    return { threadId, status: 'closed' as const };
  }

  async recordLiveSessionEvent(token: string, value: LiveSessionEvent) {
    await this.ensureSchema();
    const event = LiveSessionEventSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (grant.interactionId !== event.interactionId || grant.senderAgentId !== event.agentId)
      throw new Error('Session credential does not match the event');
    const sessions = await this.sql`
      SELECT 1 FROM openclasp_live_sessions
      WHERE interaction_id = ${event.interactionId}
        AND status = 'active'
        AND ${event.agentId} IN (initiator_agent_id, responder_agent_id)
    `;
    if (!sessions.length) throw new Error('Active live session not found');
    const attestation = attestSessionRecord(this.gatewaySecret(), event);
    const encoded = JSON.stringify({ ...event, attestation });
    const rows = await this.sql`
      INSERT INTO openclasp_live_session_events(
        interaction_id, event_id, agent_id, sequence, event
      ) SELECT ${event.interactionId}, ${event.eventId}, ${event.agentId}, ${event.sequence}, ${encoded}::jsonb
      WHERE (
        SELECT COUNT(*) FROM openclasp_live_session_events
        WHERE interaction_id = ${event.interactionId}
      ) < 1000
      ON CONFLICT DO NOTHING
      RETURNING event_id
    `;
    if (rows.length)
      await this.journalLiveSessionEvent({
        ...event,
        attestation,
      });
    if (event.type === 'session_completed' || event.type === 'session_failed') {
      const terminal = await this.sql`
        SELECT COUNT(DISTINCT agent_id) AS count
        FROM openclasp_live_session_events
        WHERE interaction_id = ${event.interactionId}
          AND event->>'type' IN ('session_completed', 'session_failed')
      `;
      if (Number(terminal[0]?.count ?? 0) >= 2) {
        await this.sql`
          UPDATE openclasp_live_sessions SET status = 'completed', completed_at = NOW()
          WHERE interaction_id = ${event.interactionId} AND status = 'active'
        `;
        const completedAt = new Date().toISOString();
        await this.sql`
          UPDATE openclasp_federated_interactions
          SET status = 'completed',
            payload = jsonb_set(
              jsonb_set(payload, '{status}', '"completed"'::jsonb),
              '{updatedAt}', to_jsonb(${completedAt}::text)
            ),
            updated_at = NOW()
          WHERE interaction_id = ${event.interactionId} AND status = 'active'
        `;
        await Promise.all([
          this.journalLiveSessionState(event.interactionId),
          this.journalFederatedInteraction(event.interactionId),
        ]);
      }
    }
    return {
      recorded: rows.length > 0,
      deduplicated: rows.length === 0,
      eventId: event.eventId,
      attestation,
    };
  }

  async createFederatedInteraction(
    operatorId: string,
    value: FederatedInteraction,
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    let interaction = FederatedInteractionSchema.parse(value);
    if (interaction.status !== 'pending') throw new Error('New interactions must be pending');
    if (interaction.contractRevision !== 1 || interaction.contractRevisions.length)
      throw new Error('New interactions cannot supply contract revision history');
    if (interaction.contract.interactionId !== interaction.interactionId)
      throw new Error('Contract interaction ID does not match');
    if (canonicalHash(interaction.contract) !== interaction.termsHash)
      throw new Error('Contract hash does not match the immutable terms');
    if (
      interaction.contract.parties.length !== 2 ||
      interaction.contract.parties[0] !== interaction.initiatorAgentId ||
      interaction.contract.parties[1] !== interaction.responderAgentId
    )
      throw new Error('Contract parties do not match the interaction participants');
    const acceptanceEntries = Object.entries(interaction.acceptances);
    if (
      acceptanceEntries.length !== 1 ||
      acceptanceEntries[0]?.[0] !== interaction.initiatorAgentId ||
      acceptanceEntries[0]?.[1].agentId !== interaction.initiatorAgentId ||
      acceptanceEntries[0]?.[1].termsHash !== interaction.termsHash ||
      !['oauth_installation', 'oauth_account'].includes(acceptanceEntries[0]?.[1].method ?? '')
    )
      throw new Error('A pending interaction requires only the initiator acceptance');
    if (Date.parse(interaction.expiresAt) <= Date.now())
      throw new Error('Interaction expiry must be in the future');
    interaction = withContractRevisionHistory(interaction);
    const owners = await this.sql`
      SELECT agent_id, operator_id, card FROM openclasp_public_agents
      WHERE agent_id IN (${interaction.initiatorAgentId}, ${interaction.responderAgentId})
    `;
    const initiator = owners.find((row) => row.agent_id === interaction.initiatorAgentId);
    const responder = owners.find((row) => row.agent_id === interaction.responderAgentId);
    if (!initiator || initiator.operator_id !== operatorId)
      throw new Error('The initiating agent must be published and owned by this account');
    if (!responder) throw new Error('Responder is not a published OpenClasp agent');
    if (responder.operator_id === operatorId)
      throw new Error('Federated interactions require agents from different accounts');
    const responderCard = normalizePublicAgentCard(responder.card);
    if (
      !responderCard.transports.some(
        (transport) =>
          transport.endpoint === interaction.responderTransport.endpoint &&
          transport.protocolBinding === interaction.responderTransport.protocolBinding,
      )
    )
      throw new Error('Responder transport does not match its published Agent Card');
    const encoded = JSON.stringify(interaction);
    const rows = await this.sql`
      INSERT INTO openclasp_federated_interactions(
        interaction_id, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id, status, payload, expires_at
      ) VALUES (
        ${interaction.interactionId}, ${operatorId}, ${responder.operator_id},
        ${interaction.initiatorAgentId}, ${interaction.responderAgentId},
        ${interaction.status}, ${encoded}::jsonb, ${interaction.expiresAt}
      )
      RETURNING payload
    `;
    const stored = FederatedInteractionSchema.parse(rows[0]?.payload);
    await this.journalFederatedInteraction(stored.interactionId);
    const profiles = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${responder.operator_id}
        AND kind = 'agent_profile'
        AND record_id = ${interaction.responderAgentId}
      LIMIT 1
    `;
    const responderProfile = profiles[0]?.payload as AgentProfile | undefined;
    if (responderProfile && canAutoAcceptInteraction(responderProfile, stored))
      return this.respondToFederatedInteraction(
        String(responder.operator_id),
        stored.interactionId,
        stored.responderAgentId,
        'accept',
        'policy_auto_accept',
      );
    return stored;
  }

  async listFederatedInteractions(operatorId: string): Promise<FederatedInteraction[]> {
    await this.ensureSchema();
    const expired = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = 'expired', payload = jsonb_set(payload, '{status}', '"expired"'::jsonb), updated_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()
      RETURNING interaction_id
    `;
    await Promise.all(
      expired.map((row) => this.journalFederatedInteraction(String(row.interaction_id))),
    );
    const rows = await this.sql`
      SELECT payload FROM openclasp_federated_interactions
      WHERE initiator_operator_id = ${operatorId} OR responder_operator_id = ${operatorId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) =>
      withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload)),
    );
  }

  async getFederatedInteraction(
    operatorId: string,
    interactionId: string,
  ): Promise<FederatedInteraction | undefined> {
    const values = await this.listFederatedInteractions(operatorId);
    return values.find((value) => value.interactionId === interactionId);
  }

  async respondToFederatedInteraction(
    operatorId: string,
    interactionId: string,
    agentId: string,
    decision: 'accept' | 'reject',
    method: 'oauth_installation' | 'oauth_account' | 'policy_auto_accept' = 'oauth_account',
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, responder_operator_id, responder_agent_id
      FROM openclasp_federated_interactions WHERE interaction_id = ${interactionId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction invitation not found');
    if (row.responder_operator_id !== operatorId || row.responder_agent_id !== agentId)
      throw new Error('Only the invited agent may respond');
    const current = withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload));
    if (current.status !== 'pending') throw new Error('Invitation is no longer pending');
    const now = new Date().toISOString();
    if (Date.parse(current.expiresAt) <= Date.now()) {
      const expired = { ...current, status: 'expired' as const, updatedAt: now };
      await this.updateFederatedInteraction(
        interactionId,
        current.status,
        expired,
        current.updatedAt,
      );
      throw new Error('Invitation has expired');
    }
    const proposed = openContractRevision(current);
    if (!proposed || proposed.termsHash !== current.termsHash)
      throw new Error('No current contract proposal is available');
    const acceptance = {
      agentId,
      method,
      termsHash: current.termsHash,
      acceptedAt: now,
    };
    const proposalBase: ContractRevision = {
      ...proposed,
      status: decision === 'accept' ? 'accepted' : 'rejected',
      acceptances:
        decision === 'accept'
          ? { ...proposed.acceptances, [agentId]: acceptance }
          : proposed.acceptances,
      updatedAt: now,
    };
    const resolvedProposal =
      decision === 'accept'
        ? ContractRevisionSchema.parse({
            ...proposalBase,
            platformAttestation: attestSessionRecord(this.gatewaySecret(), proposalBase),
          })
        : proposalBase;
    const next = FederatedInteractionSchema.parse({
      ...current,
      status: decision === 'accept' ? 'active' : 'rejected',
      updatedAt: now,
      acceptances: decision === 'accept' ? resolvedProposal.acceptances : current.acceptances,
      contractRevisions: current.contractRevisions.map((revision) =>
        revision.revisionId === resolvedProposal.revisionId ? resolvedProposal : revision,
      ),
    });
    if (decision === 'accept') {
      try {
        await this.brokerLiveSession(next);
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 500) : 'Live session failed';
        await this.sql`
          UPDATE openclasp_agent_runtimes SET last_error = ${reason}, updated_at = NOW()
          WHERE agent_id IN (${current.initiatorAgentId}, ${current.responderAgentId})
        `;
        throw error;
      }
    }
    const updated = await this.updateFederatedInteraction(
      interactionId,
      current.status,
      next,
      current.updatedAt,
    );
    if (!updated) throw new Error('Invitation was already handled');
    return next;
  }

  async proposeContractRevision(
    operatorId: string,
    interactionId: string,
    agentId: string,
    contract: InteractionContract,
    expectedTermsHash?: string,
    method: 'oauth_installation' | 'oauth_account' = 'oauth_account',
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction not found');
    const ownsParticipant =
      (row.initiator_operator_id === operatorId && row.initiator_agent_id === agentId) ||
      (row.responder_operator_id === operatorId && row.responder_agent_id === agentId);
    if (!ownsParticipant) throw new Error('Only a participating agent may propose contract terms');
    const current = withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload));
    if (!['pending', 'active'].includes(current.status))
      throw new Error('This interaction no longer accepts contract proposals');
    const parsedContract = InteractionContractSchema.parse(contract);
    if (parsedContract.interactionId !== interactionId)
      throw new Error('Contract interaction ID does not match');
    if (
      parsedContract.parties.length !== 2 ||
      parsedContract.parties[0] !== current.initiatorAgentId ||
      parsedContract.parties[1] !== current.responderAgentId
    )
      throw new Error('Contract parties cannot change during negotiation');
    const open = openContractRevision(current);
    const expected = open?.termsHash ?? current.termsHash;
    if (expectedTermsHash && expectedTermsHash !== expected)
      throw new Error('Contract terms changed; fetch the interaction before countering');
    const termsHash = canonicalHash(parsedContract);
    if (termsHash === expected) throw new Error('Proposed terms are unchanged');
    const now = new Date().toISOString();
    const revisionNumber =
      Math.max(
        current.contractRevision,
        ...current.contractRevisions.map((item) => item.revision),
      ) + 1;
    const acceptance = {
      agentId,
      method,
      termsHash,
      acceptedAt: now,
    } as const;
    const revision = ContractRevisionSchema.parse({
      revisionId: crypto.randomUUID(),
      interactionId,
      revision: revisionNumber,
      previousTermsHash: expected,
      termsHash,
      contract: parsedContract,
      proposedByAgentId: agentId,
      status: 'proposed',
      acceptances: { [agentId]: acceptance },
      createdAt: now,
      updatedAt: now,
    });
    const revisions = [
      ...current.contractRevisions.map((item) =>
        item.status === 'proposed'
          ? ContractRevisionSchema.parse({ ...item, status: 'superseded', updatedAt: now })
          : item,
      ),
      revision,
    ];
    const next = FederatedInteractionSchema.parse({
      ...current,
      ...(current.status === 'pending'
        ? {
            contract: parsedContract,
            termsHash,
            acceptances: revision.acceptances,
            contractRevision: revisionNumber,
          }
        : {}),
      contractRevisions: revisions,
      updatedAt: now,
    });
    const updated = await this.updateFederatedInteraction(
      interactionId,
      current.status,
      next,
      current.updatedAt,
    );
    if (!updated) throw new Error('Contract changed concurrently; fetch it and retry');
    return next;
  }

  async respondToContractRevision(
    operatorId: string,
    interactionId: string,
    agentId: string,
    revisionId: string,
    decision: 'accept' | 'reject',
    method: 'oauth_installation' | 'oauth_account' = 'oauth_account',
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction not found');
    const ownsParticipant =
      (row.initiator_operator_id === operatorId && row.initiator_agent_id === agentId) ||
      (row.responder_operator_id === operatorId && row.responder_agent_id === agentId);
    if (!ownsParticipant) throw new Error('Only a participating agent may respond to terms');
    const current = withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload));
    if (!['pending', 'active'].includes(current.status))
      throw new Error('This interaction no longer accepts contract responses');
    const proposal = openContractRevision(current);
    if (!proposal || proposal.revisionId !== revisionId)
      throw new Error('Contract proposal is no longer current');
    if (proposal.acceptances[agentId]) throw new Error('Agent already accepted this proposal');
    const now = new Date().toISOString();
    const acceptances =
      decision === 'accept'
        ? {
            ...proposal.acceptances,
            [agentId]: { agentId, method, termsHash: proposal.termsHash, acceptedAt: now },
          }
        : proposal.acceptances;
    const fullyAccepted = current.contract.parties.every((party) => party in acceptances);
    const revisionBase = ContractRevisionSchema.parse({
      ...proposal,
      status: decision === 'reject' ? 'rejected' : fullyAccepted ? 'accepted' : 'proposed',
      acceptances,
      updatedAt: now,
    });
    const revision =
      fullyAccepted && decision === 'accept'
        ? ContractRevisionSchema.parse({
            ...revisionBase,
            platformAttestation: attestSessionRecord(this.gatewaySecret(), revisionBase),
          })
        : revisionBase;
    const next = FederatedInteractionSchema.parse({
      ...current,
      status:
        current.status === 'pending'
          ? decision === 'reject'
            ? 'rejected'
            : fullyAccepted
              ? 'active'
              : 'pending'
          : 'active',
      ...(fullyAccepted
        ? {
            contract: revision.contract,
            termsHash: revision.termsHash,
            acceptances: revision.acceptances,
            contractRevision: revision.revision,
          }
        : {}),
      contractRevisions: current.contractRevisions.map((item) =>
        item.revisionId === revision.revisionId ? revision : item,
      ),
      updatedAt: now,
    });
    if (current.status === 'pending' && decision === 'accept' && fullyAccepted)
      await this.brokerLiveSession(next);
    const updated = await this.updateFederatedInteraction(
      interactionId,
      current.status,
      next,
      current.updatedAt,
    );
    if (!updated) throw new Error('Contract changed concurrently; fetch it and retry');
    return next;
  }

  private async updateFederatedInteraction(
    interactionId: string,
    expectedStatus: string,
    value: FederatedInteraction,
    expectedUpdatedAt?: string,
  ): Promise<boolean> {
    const encoded = JSON.stringify(FederatedInteractionSchema.parse(value));
    const rows = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = ${value.status}, payload = ${encoded}::jsonb, updated_at = NOW()
      WHERE interaction_id = ${interactionId} AND status = ${expectedStatus}
        AND (${expectedUpdatedAt ?? null}::text IS NULL OR payload->>'updatedAt' = ${expectedUpdatedAt ?? null})
      RETURNING interaction_id
    `;
    if (rows.length) await this.journalFederatedInteraction(interactionId);
    return rows.length > 0;
  }

  async getSettings(operatorId: string): Promise<AccountSettings> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT display_name, contribution_enabled, retention_days, evidence_sharing
      FROM openclasp_account_settings
      WHERE operator_id = ${operatorId}
    `;
    const row = rows[0] as
      | {
          display_name: string;
          contribution_enabled: boolean;
          retention_days: number;
          evidence_sharing: AccountSettings['evidenceSharing'];
        }
      | undefined;
    return row
      ? {
          displayName: row.display_name,
          contributionEnabled: row.contribution_enabled,
          retentionDays: row.retention_days,
          evidenceSharing: row.evidence_sharing,
          rawConversationsStored: false,
        }
      : defaults;
  }

  async saveSettings(
    operatorId: string,
    settings: Omit<AccountSettings, 'rawConversationsStored'>,
  ): Promise<AccountSettings> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO openclasp_account_settings(
        operator_id, display_name, contribution_enabled, retention_days, evidence_sharing
      ) VALUES (
        ${operatorId}, ${settings.displayName}, ${settings.contributionEnabled},
        ${settings.retentionDays}, ${settings.evidenceSharing}
      )
      ON CONFLICT (operator_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        contribution_enabled = EXCLUDED.contribution_enabled,
        retention_days = EXCLUDED.retention_days,
        evidence_sharing = EXCLUDED.evidence_sharing,
        updated_at = NOW()
    `;
    return { ...settings, rawConversationsStored: false };
  }
}
