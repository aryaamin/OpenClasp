import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

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

export type PublicAgentCard = {
  agentId: string;
  name: string;
  framework: string;
  capabilities: string[];
  limitations: string[];
  assurance: 'oauth_authenticated' | 'cryptographically_verified';
  publishedAt: string;
  updatedAt: string;
};

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
    };
  }

  async publishAgent(operatorId: string, card: PublicAgentCard): Promise<PublicAgentCard> {
    await this.ensureSchema();
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
    return rows[0]?.card as PublicAgentCard | undefined;
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
      .map((row) => row.card as PublicAgentCard)
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
