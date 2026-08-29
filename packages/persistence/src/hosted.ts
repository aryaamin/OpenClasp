import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_EXTENSION_URI,
  FederatedInteractionSchema,
  LiveSessionAcceptanceSchema,
  LiveSessionActivationSchema,
  LiveSessionEventSchema,
  LiveSessionOfferSchema,
  HostedMessageSchema,
  HostedThreadSchema,
  PublicAgentCardSchema,
  canonicalHash,
  type FederatedInteraction,
  type AgentPresence,
  type LiveSessionActivation,
  type LiveSessionEvent,
  type LiveSessionInsight,
  type HostedMessage,
  type HostedThread,
  type PublicAgentCard,
} from '../../protocol/src/index.js';
import type { AgentProfile } from './onboarding.js';
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

export type HostedRecordKind =
  | 'agent'
  | 'delegation'
  | 'contract'
  | 'interaction'
  | 'event'
  | 'receipt'
  | 'feedback'
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
  agentVersion: string;
  sampleSize: number;
  updatedAt: string;
  completion: number;
  acceptance: number;
  specification: number;
  deadline: number;
  communication: number;
  evidence: number;
  scope: number;
  disputes: number;
};

function normalizePublicAgentCard(value: unknown): PublicAgentCard {
  const current = PublicAgentCardSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = value as Record<string, unknown>;
  const agentId = String(legacy.agentId ?? '');
  const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
    /\/$/,
    '',
  );
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
    cardUrl: `${baseUrl}/agents/${encodeURIComponent(agentId)}/card.json`,
    a2aAgentCardUrl: `${baseUrl}/agents/${encodeURIComponent(agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
    publishedAt: legacy.publishedAt,
    updatedAt: legacy.updatedAt,
  });
}

export function buildPublicAgentCard(
  agent: AgentProfile,
  baseUrl: string,
  previous?: PublicAgentCard,
): PublicAgentCard {
  const now = new Date().toISOString();
  const root = baseUrl.replace(/\/$/, '');
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
    cardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/card.json`,
    a2aAgentCardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
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

  ensureSchema(): Promise<void> {
    return (this.initialized ??= (async () => {
      await this.sql`
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
      await this.sql`
        CREATE INDEX IF NOT EXISTS openclasp_records_operator_created
        ON openclasp_records(operator_id, created_at DESC)
      `;
      await this.sql`
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
      await this.sql`
        CREATE TABLE IF NOT EXISTS openclasp_public_agents (
          agent_id TEXT PRIMARY KEY,
          operator_id TEXT NOT NULL,
          card JSONB NOT NULL,
          published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS openclasp_public_agents_updated
        ON openclasp_public_agents(updated_at DESC)
      `;
      await this.sql`
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
      await this.sql`
        CREATE INDEX IF NOT EXISTS openclasp_federated_interactions_participants
        ON openclasp_federated_interactions(initiator_operator_id, responder_operator_id, updated_at DESC)
      `;
      await this.sql`
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
      await this.sql`
        ALTER TABLE openclasp_agent_runtimes
        ADD COLUMN IF NOT EXISTS a2a_endpoint TEXT,
        ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ
      `;
      await this.sql`
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
      await this.sql`
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
      await this.sql`
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
      await this.sql`
        CREATE INDEX IF NOT EXISTS openclasp_hosted_threads_participants
        ON openclasp_hosted_threads(participant_a_agent_id, participant_b_agent_id, updated_at DESC)
      `;
      await this.sql`
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
      await this.sql`
        CREATE UNIQUE INDEX IF NOT EXISTS openclasp_hosted_messages_dedup
        ON openclasp_hosted_messages(thread_id, sender_agent_id, request_key)
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS openclasp_hosted_messages_thread_created
        ON openclasp_hosted_messages(thread_id, created_at ASC)
      `;
    })());
  }

  getRuntimeVerificationKey() {
    return {
      algorithm: 'Ed25519' as const,
      keyId: getSessionKeyId(this.gatewaySecret()),
      publicKey: getSessionVerificationKey(this.gatewaySecret()),
    };
  }

  async upsert(
    operatorId: string,
    kind: HostedRecordKind,
    recordId: string,
    payload: unknown,
  ): Promise<void> {
    await this.ensureSchema();
    const encoded = JSON.stringify(payload);
    await this.sql`
      INSERT INTO openclasp_records(operator_id, kind, record_id, payload)
      VALUES (${operatorId}, ${kind}, ${recordId}, ${encoded}::jsonb)
      ON CONFLICT (operator_id, kind, record_id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `;
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
    const rows = await this.list(operatorId);
    const [federatedInteractions, runtimes, liveSessionRows, liveEventRows] = await Promise.all([
      this.listFederatedInteractions(operatorId),
      this.listAgentRuntimes(operatorId),
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
    return published;
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
    return { ...card, presence: await this.getAgentPresence(agentId) };
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
        return { ...card, presence: resolveAgentPresence(presence.get(card.agentId)) };
      })
      .filter(
        (card) =>
          (!query ||
            card.name.toLowerCase().includes(query) ||
            card.framework.toLowerCase().includes(query)) &&
          (!capability ||
            card.capabilities.some((value) => value.toLowerCase().includes(capability))),
      )
      .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));
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
  ): Promise<LiveSessionInsight[]> {
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
    if (!current) {
      insights.push({
        code: 'limited_verified_history',
        severity: 'caution',
        message: `No eligible ${taskCategory} history is available for this agent version. Ask for task-relevant evidence.`,
        evidenceReferences: [],
      });
    } else {
      const ageDays = Math.max(
        0,
        (Date.now() - Date.parse(String(current.updatedAt))) / 86_400_000,
      );
      const freshness = Math.exp(-ageDays / 180);
      const sampleSize = Number(current.sampleSize);
      const confidence = Math.min(0.95, (sampleSize / (sampleSize + 5)) * freshness);
      const versionChanged = current.agentVersion !== counterparty.card.agentVersion;
      const reference = `openclasp:profile:${current.recordId}`;
      insights.push({
        code: versionChanged ? 'version_history_only' : 'contextual_history',
        severity: versionChanged || confidence < 0.25 ? 'caution' : 'info',
        message: versionChanged
          ? `Only prior-version ${taskCategory} history is available (${sampleSize} eligible interaction${sampleSize === 1 ? '' : 's'}); confidence is reduced for version ${counterparty.card.agentVersion}.`
          : `Based on ${sampleSize} eligible ${taskCategory} interaction${sampleSize === 1 ? '' : 's'}; confidence ${(confidence * 100).toFixed(0)}%.`,
        evidenceReferences: [reference],
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
        });
      if (Number(current.disputes) > 0.25)
        insights.push({
          code: 'elevated_dispute_history',
          severity: Number(current.disputes) >= 0.5 ? 'high' : 'caution',
          message: `Eligible feedback shows a ${(Number(current.disputes) * 100).toFixed(0)}% dispute rate in this task category.`,
          evidenceReferences: [reference],
        });
    }
    if (counterparty.card.limitations.length)
      insights.push({
        code: 'declared_limitations',
        severity: 'info',
        message: `Counterparty declares: ${counterparty.card.limitations.join('; ')}`,
        evidenceReferences: [counterparty.card.cardUrl],
      });
    return insights;
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
    const [initiatorInsights, responderInsights] = await Promise.all([
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
    const makeOffer = (
      runtime: typeof initiator,
      counterparty: typeof responder,
      role: 'initiator' | 'responder',
      privateInsights: LiveSessionInsight[],
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
        issuedAt,
        expiresAt: interaction.expiresAt,
      });
    const initiatorOffer = makeOffer(initiator, responder, 'initiator', initiatorInsights);
    const responderOffer = makeOffer(responder, initiator, 'responder', responderInsights);
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
        status = 'preparing', expires_at = EXCLUDED.expires_at, last_error = NULL
    `;
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
          bearerToken,
        },
        privateInsights,
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
      initiatorInsights,
    );
    const responderActivation = makeActivation(
      responder.agentId,
      responderAcceptance.sessionId,
      'responder',
      initiator.agentId,
      initiatorAcceptance.sessionId,
      initiatorAcceptance.a2aEndpoint,
      responderInsights,
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
    const privateInsights = await this.privateCounterpartyInsights(
      String(owner),
      peer,
      interaction.contract.taskCategory,
    );
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
        bearerToken,
      },
      privateInsights,
      contractHash: interaction.termsHash,
      activatedAt: row.activated_at
        ? new Date(String(row.activated_at)).toISOString()
        : new Date().toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
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
    const decrypted = decryptGatewayPayload(this.gatewaySecret(), {
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
    return { message: this.hostedMessage(inserted[0]), deduplicated: false };
  }

  async receiveTemporaryMessage(
    token: string,
    recipientAgentId: string,
    requestKey: string,
    content: string,
  ) {
    await this.ensureSchema();
    const grant = verifySessionGrant(this.gatewaySecret(), token);
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
    const grant = verifySessionGrant(this.gatewaySecret(), token);
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
    const interaction = FederatedInteractionSchema.parse(value);
    if (interaction.status !== 'pending') throw new Error('New interactions must be pending');
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
    await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = 'expired', payload = jsonb_set(payload, '{status}', '"expired"'::jsonb), updated_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()
    `;
    const rows = await this.sql`
      SELECT payload FROM openclasp_federated_interactions
      WHERE initiator_operator_id = ${operatorId} OR responder_operator_id = ${operatorId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => FederatedInteractionSchema.parse(row.payload));
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
    const current = FederatedInteractionSchema.parse(row.payload);
    if (current.status !== 'pending') throw new Error('Invitation is no longer pending');
    const now = new Date().toISOString();
    if (Date.parse(current.expiresAt) <= Date.now()) {
      const expired = { ...current, status: 'expired' as const, updatedAt: now };
      await this.updateFederatedInteraction(interactionId, current.status, expired);
      throw new Error('Invitation has expired');
    }
    const next: FederatedInteraction =
      decision === 'reject'
        ? { ...current, status: 'rejected', updatedAt: now }
        : {
            ...current,
            status: 'active',
            updatedAt: now,
            acceptances: {
              ...current.acceptances,
              [agentId]: {
                agentId,
                method,
                termsHash: current.termsHash,
                acceptedAt: now,
              },
            },
          };
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
    const updated = await this.updateFederatedInteraction(interactionId, current.status, next);
    if (!updated) throw new Error('Invitation was already handled');
    return next;
  }

  private async updateFederatedInteraction(
    interactionId: string,
    expectedStatus: string,
    value: FederatedInteraction,
  ): Promise<boolean> {
    const encoded = JSON.stringify(FederatedInteractionSchema.parse(value));
    const rows = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = ${value.status}, payload = ${encoded}::jsonb, updated_at = NOW()
      WHERE interaction_id = ${interactionId} AND status = ${expectedStatus}
      RETURNING interaction_id
    `;
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
