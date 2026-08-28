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
  | 'setup_request';

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
      interactions: ofKind('interaction'),
      events: ofKind('event'),
      conflicts: ofKind('conflict'),
      receipts: ofKind('receipt'),
      profiles: ofKind('profile'),
    };
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
