import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  DEFAULT_EXTENSION_URI,
  FederatedInteractionSchema,
  PublicAgentCardSchema,
  canonicalHash,
  type FederatedInteraction,
  type PublicAgentCard,
} from '../../protocol/src/index.js';
import type { AgentProfile } from './onboarding.js';

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
  | 'publication';

export type { PublicAgentCard, FederatedInteraction } from '../../protocol/src/index.js';

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
    transports: [],
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
    transports: agent.a2aEndpoint
      ? [{ protocol: 'A2A/1.0', protocolBinding: 'JSONRPC', endpoint: agent.a2aEndpoint }]
      : [],
    cardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/card.json`,
    a2aAgentCardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
    publishedAt: previous?.publishedAt ?? now,
    updatedAt: now,
  });
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
    })());
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
    return {
      agents: [...ofKind('agent_profile'), ...ofKind('agent')],
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
    return rows[0]?.card ? normalizePublicAgentCard(rows[0].card) : undefined;
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
    return rows
      .map((row) => normalizePublicAgentCard(row.card))
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
    return FederatedInteractionSchema.parse(rows[0]?.payload);
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
    method: 'oauth_installation' | 'oauth_account' = 'oauth_account',
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
