import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  DEFAULT_EXTENSION_URI,
  FederatedInteractionSchema,
  PublicAgentCardSchema,
  canonicalHash,
  type FederatedInteraction,
  type AgentPresence,
  type PublicAgentCard,
} from '../../protocol/src/index.js';
import type { AgentProfile } from './onboarding.js';
import {
  decryptGatewayPayload,
  encryptGatewayPayload,
  issueGatewayGrant,
  verifyGatewayGrant,
  type GatewayGrant,
} from './relay.js';

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

function normalizePublicAgentCard(value: unknown): PublicAgentCard {
  const current = PublicAgentCardSchema.safeParse(value);
  if (current.success) {
    const card = current.data;
    const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
      /\/$/,
      '',
    );
    return PublicAgentCardSchema.parse({
      ...card,
      transports: [
        {
          protocol: 'A2A/1.0',
          protocolBinding: 'JSONRPC',
          endpoint: `${baseUrl}/a2a/${encodeURIComponent(card.agentId)}`,
          managedBy: 'openclasp',
        },
      ],
    });
  }
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
    transports: [
      {
        protocol: 'A2A/1.0',
        protocolBinding: 'JSONRPC',
        endpoint: `${baseUrl}/a2a/${encodeURIComponent(agentId)}`,
        managedBy: 'openclasp',
      },
    ],
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
    transports: [
      {
        protocol: 'A2A/1.0',
        protocolBinding: 'JSONRPC',
        endpoint: `${root}/a2a/${encodeURIComponent(agent.agentId)}`,
        managedBy: 'openclasp',
      },
    ],
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
  rawConversationsStored: true;
};

const defaults: AccountSettings = {
  displayName: '',
  contributionEnabled: false,
  retentionDays: 30,
  evidenceSharing: 'ask',
  rawConversationsStored: true,
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
        CREATE TABLE IF NOT EXISTS openclasp_gateway_messages (
          message_id TEXT PRIMARY KEY,
          idempotency_key TEXT UNIQUE,
          interaction_id TEXT NOT NULL,
          sender_agent_id TEXT NOT NULL,
          recipient_agent_id TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          content_type TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          delivered_at TIMESTAMPTZ
        )
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS openclasp_gateway_messages_inbox
        ON openclasp_gateway_messages(recipient_agent_id, created_at ASC)
      `;
    })());
  }

  issueGatewayToken(interaction: FederatedInteraction): string {
    return issueGatewayGrant(this.gatewaySecret(), {
      interactionId: interaction.interactionId,
      senderAgentId: interaction.initiatorAgentId,
      recipientAgentId: interaction.responderAgentId,
      expiresAt: Math.min(Date.parse(interaction.expiresAt), Date.now() + 60 * 60_000),
    });
  }

  verifyGatewayToken(token: string): GatewayGrant {
    return verifyGatewayGrant(this.gatewaySecret(), token);
  }

  async enqueueGatewayMessage(input: {
    interactionId: string;
    senderAgentId: string;
    recipientAgentId: string;
    payload: unknown;
    contentType?: string;
    idempotencyKey?: string;
  }) {
    await this.ensureSchema();
    const values = await this.sql`
      SELECT payload FROM openclasp_federated_interactions
      WHERE interaction_id = ${input.interactionId} AND status = 'active'
    `;
    const interaction = values[0]?.payload
      ? FederatedInteractionSchema.parse(values[0].payload)
      : undefined;
    if (!interaction) throw new Error('An active OpenClasp interaction is required');
    const parties = new Set([interaction.initiatorAgentId, interaction.responderAgentId]);
    if (
      !parties.has(input.senderAgentId) ||
      !parties.has(input.recipientAgentId) ||
      input.senderAgentId === input.recipientAgentId
    )
      throw new Error('Gateway participants do not match the interaction');
    const encrypted = encryptGatewayPayload(this.gatewaySecret(), input.payload);
    const messageId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const rows = await this.sql`
      INSERT INTO openclasp_gateway_messages(
        message_id, idempotency_key, interaction_id, sender_agent_id, recipient_agent_id,
        ciphertext, iv, auth_tag, content_type, expires_at
      ) VALUES (
        ${messageId}, ${input.idempotencyKey ?? null}, ${input.interactionId},
        ${input.senderAgentId}, ${input.recipientAgentId}, ${encrypted.ciphertext},
        ${encrypted.iv}, ${encrypted.authTag}, ${input.contentType ?? 'application/json'}, ${expiresAt}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING message_id
    `;
    return {
      accepted: true,
      deduplicated: rows.length === 0,
      messageId: rows.length ? String(rows[0]?.message_id) : undefined,
      expiresAt,
    };
  }

  async listGatewayMessages(operatorId: string, agentId: string, limit = 20) {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    if (!owned.length) throw new Error('Agent is not owned by this account');
    await this.sql`DELETE FROM openclasp_gateway_messages WHERE expires_at <= NOW()`;
    const rows = await this.sql`
      UPDATE openclasp_gateway_messages SET delivered_at = COALESCE(delivered_at, NOW())
      WHERE message_id IN (
        SELECT message_id FROM openclasp_gateway_messages
        WHERE recipient_agent_id = ${agentId} AND expires_at > NOW()
        ORDER BY created_at ASC LIMIT ${Math.min(Math.max(limit, 1), 50)}
      )
      RETURNING message_id, interaction_id, sender_agent_id, recipient_agent_id,
        ciphertext, iv, auth_tag, content_type, created_at, expires_at
    `;
    return rows.map((row) => ({
      messageId: String(row.message_id),
      interactionId: String(row.interaction_id),
      senderAgentId: String(row.sender_agent_id),
      recipientAgentId: String(row.recipient_agent_id),
      contentType: String(row.content_type),
      createdAt: new Date(String(row.created_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      payload: decryptGatewayPayload(this.gatewaySecret(), {
        ciphertext: String(row.ciphertext),
        iv: String(row.iv),
        authTag: String(row.auth_tag),
      }),
    }));
  }

  async acknowledgeGatewayMessage(operatorId: string, agentId: string, messageId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      DELETE FROM openclasp_gateway_messages message
      USING openclasp_records agent
      WHERE message.message_id = ${messageId}
        AND message.recipient_agent_id = ${agentId}
        AND agent.operator_id = ${operatorId}
        AND agent.kind = 'agent_profile'
        AND agent.record_id = ${agentId}
      RETURNING message.message_id
    `;
    if (!rows.length) throw new Error('Gateway message not found');
    return { acknowledged: true, messageId };
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
    const federatedInteractions = await this.listFederatedInteractions(operatorId);
    const ofKind = (kind: HostedRecordKind) =>
      rows.filter((row) => row.kind === kind).map((row) => row.payload);
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
      events: ofKind('event'),
      conflicts: ofKind('conflict'),
      receipts: ofKind('receipt'),
      profiles: ofKind('profile'),
      federatedInteractions,
    };
  }

  async publishAgent(operatorId: string, card: PublicAgentCard): Promise<PublicAgentCard> {
    await this.ensureSchema();
    card = PublicAgentCardSchema.parse(card);
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
      SELECT card FROM openclasp_public_agents WHERE agent_id = ${agentId}
    `;
    if (!rows[0]?.card) return undefined;
    const card = normalizePublicAgentCard(rows[0].card);
    return { ...card, presence: await this.getAgentPresence(agentId) };
  }

  async searchPublishedAgents(input: {
    query?: string | undefined;
    capability?: string | undefined;
    limit?: number | undefined;
  }): Promise<PublicAgentCard[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT card FROM openclasp_public_agents ORDER BY updated_at DESC LIMIT 100
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
        const card = normalizePublicAgentCard(row.card);
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
          rawConversationsStored: true,
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
    return { ...settings, rawConversationsStored: true };
  }
}
