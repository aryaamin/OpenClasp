import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

// Shared runtime code lives outside /api so Vercel does not count it as a function.

export type OAuthClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
};

export type OAuthTransaction = {
  transactionId: string;
  clientId: string;
  redirectUri: string;
  downstreamState?: string;
  scope: string;
  codeChallenge: string;
  auth0Verifier: string;
};

export type OAuthAuthorizationCode = {
  clientId: string;
  operatorId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
};

export type OAuthAccessToken = {
  clientId: string;
  operatorId: string;
  scopes: string[];
  expiresAt: string;
};

const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
export const randomOAuthValue = (prefix: string) =>
  `${prefix}${randomBytes(32).toString('base64url')}`;

export class OAuthStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private initialized?: Promise<void>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  ensureSchema(): Promise<void> {
    return (this.initialized ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS openclasp_oauth_clients (
          client_id TEXT PRIMARY KEY,
          client_name TEXT,
          redirect_uris JSONB NOT NULL,
          metadata JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sql`
        CREATE TABLE IF NOT EXISTS openclasp_oauth_transactions (
          transaction_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL REFERENCES openclasp_oauth_clients(client_id) ON DELETE CASCADE,
          redirect_uri TEXT NOT NULL,
          downstream_state TEXT,
          scope TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
          auth0_verifier TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sql`
        CREATE TABLE IF NOT EXISTS openclasp_oauth_codes (
          code_hash TEXT PRIMARY KEY,
          client_id TEXT NOT NULL REFERENCES openclasp_oauth_clients(client_id) ON DELETE CASCADE,
          operator_id TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          scope TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sql`
        CREATE TABLE IF NOT EXISTS openclasp_oauth_access_tokens (
          token_hash TEXT PRIMARY KEY,
          client_id TEXT NOT NULL REFERENCES openclasp_oauth_clients(client_id) ON DELETE CASCADE,
          operator_id TEXT NOT NULL,
          scopes JSONB NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sql`
        CREATE TABLE IF NOT EXISTS openclasp_oauth_refresh_tokens (
          token_hash TEXT PRIMARY KEY,
          client_id TEXT NOT NULL REFERENCES openclasp_oauth_clients(client_id) ON DELETE CASCADE,
          operator_id TEXT NOT NULL,
          scopes JSONB NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })());
  }

  async registerClient(metadata: Record<string, unknown>): Promise<OAuthClient> {
    await this.ensureSchema();
    const canonical = canonicalize(metadata);
    const clientId = `oc_${digest(canonical).slice(0, 40)}`;
    const redirectUris = metadata.redirect_uris as string[];
    const clientName = typeof metadata.client_name === 'string' ? metadata.client_name : undefined;
    await this.sql`
      INSERT INTO openclasp_oauth_clients(client_id, client_name, redirect_uris, metadata)
      VALUES (${clientId}, ${clientName ?? null}, ${JSON.stringify(redirectUris)}::jsonb,
        ${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT (client_id) DO NOTHING
    `;
    return { clientId, redirectUris, ...(clientName ? { clientName } : {}) };
  }

  async getClient(clientId: string): Promise<OAuthClient | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT client_id, client_name, redirect_uris
      FROM openclasp_oauth_clients WHERE client_id = ${clientId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      clientId: String(row.client_id),
      redirectUris: row.redirect_uris as string[],
      ...(typeof row.client_name === 'string' ? { clientName: row.client_name } : {}),
    };
  }

  async createTransaction(value: OAuthTransaction): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO openclasp_oauth_transactions(
        transaction_id, client_id, redirect_uri, downstream_state, scope,
        code_challenge, auth0_verifier, expires_at
      ) VALUES (
        ${value.transactionId}, ${value.clientId}, ${value.redirectUri},
        ${value.downstreamState ?? null}, ${value.scope}, ${value.codeChallenge},
        ${value.auth0Verifier}, NOW() + INTERVAL '10 minutes'
      )
    `;
  }

  async takeTransaction(transactionId: string): Promise<OAuthTransaction | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      DELETE FROM openclasp_oauth_transactions
      WHERE transaction_id = ${transactionId} AND expires_at > NOW()
      RETURNING transaction_id, client_id, redirect_uri, downstream_state, scope,
        code_challenge, auth0_verifier
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      transactionId: String(row.transaction_id),
      clientId: String(row.client_id),
      redirectUri: String(row.redirect_uri),
      ...(typeof row.downstream_state === 'string'
        ? { downstreamState: row.downstream_state }
        : {}),
      scope: String(row.scope),
      codeChallenge: String(row.code_challenge),
      auth0Verifier: String(row.auth0_verifier),
    };
  }

  async createAuthorizationCode(value: OAuthAuthorizationCode): Promise<string> {
    await this.ensureSchema();
    const code = randomOAuthValue('oc_code_');
    await this.sql`
      INSERT INTO openclasp_oauth_codes(
        code_hash, client_id, operator_id, redirect_uri, scope, code_challenge, expires_at
      ) VALUES (
        ${digest(code)}, ${value.clientId}, ${value.operatorId}, ${value.redirectUri},
        ${value.scope}, ${value.codeChallenge}, NOW() + INTERVAL '5 minutes'
      )
    `;
    return code;
  }

  async takeAuthorizationCode(code: string): Promise<OAuthAuthorizationCode | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_oauth_codes SET used_at = NOW()
      WHERE code_hash = ${digest(code)} AND expires_at > NOW() AND used_at IS NULL
      RETURNING client_id, operator_id, redirect_uri, scope, code_challenge
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      clientId: String(row.client_id),
      operatorId: String(row.operator_id),
      redirectUri: String(row.redirect_uri),
      scope: String(row.scope),
      codeChallenge: String(row.code_challenge),
    };
  }

  async issueTokens(
    clientId: string,
    operatorId: string,
    scopes: string[],
    includeRefresh = true,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
    await this.ensureSchema();
    const accessToken = randomOAuthValue('oc_oat_');
    const expiresIn = 3600;
    await this.sql`
      INSERT INTO openclasp_oauth_access_tokens(
        token_hash, client_id, operator_id, scopes, expires_at
      ) VALUES (
        ${digest(accessToken)}, ${clientId}, ${operatorId}, ${JSON.stringify(scopes)}::jsonb,
        NOW() + INTERVAL '1 hour'
      )
    `;
    if (!includeRefresh) return { accessToken, expiresIn };
    const refreshToken = randomOAuthValue('oc_rt_');
    await this.sql`
      INSERT INTO openclasp_oauth_refresh_tokens(
        token_hash, client_id, operator_id, scopes, expires_at
      ) VALUES (
        ${digest(refreshToken)}, ${clientId}, ${operatorId}, ${JSON.stringify(scopes)}::jsonb,
        NOW() + INTERVAL '30 days'
      )
    `;
    return { accessToken, refreshToken, expiresIn };
  }

  async verifyAccessToken(token: string): Promise<OAuthAccessToken | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT client_id, operator_id, scopes, expires_at
      FROM openclasp_oauth_access_tokens
      WHERE token_hash = ${digest(token)} AND expires_at > NOW() LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      clientId: String(row.client_id),
      operatorId: String(row.operator_id),
      scopes: row.scopes as string[],
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
  }

  async rotateRefreshToken(
    token: string,
    clientId: string,
  ): Promise<
    | {
        clientId: string;
        operatorId: string;
        scopes: string[];
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      }
    | undefined
  > {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_oauth_refresh_tokens SET revoked_at = NOW()
      WHERE token_hash = ${digest(token)} AND client_id = ${clientId}
        AND expires_at > NOW() AND revoked_at IS NULL
      RETURNING client_id, operator_id, scopes
    `;
    const row = rows[0];
    if (!row) return undefined;
    const scopes = row.scopes as string[];
    const issued = await this.issueTokens(clientId, String(row.operator_id), scopes);
    return {
      clientId,
      operatorId: String(row.operator_id),
      scopes,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken!,
      expiresIn: issued.expiresIn,
    };
  }
}

export function oauthStore(): OAuthStore {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('OAuth persistence is not configured');
  return new OAuthStore(databaseUrl);
}
