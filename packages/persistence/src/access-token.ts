import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'oc_at_';
const TOKEN_PATTERN = /^oc_at_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

export type AgentAccessTokenMetadata = {
  tokenId: string;
  agentId: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export function hashAgentAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createAgentAccessToken() {
  const tokenId = randomBytes(12).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}${tokenId}.${secret}`;
  return { tokenId, token, tokenHash: hashAgentAccessToken(token) };
}

export function agentAccessTokenId(token: string): string | undefined {
  return TOKEN_PATTERN.exec(token)?.[1];
}

export function agentAccessTokenClientId(tokenId: string): string {
  return `openclasp-agent-token:${tokenId}`;
}

export function matchesAgentAccessToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAgentAccessToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
