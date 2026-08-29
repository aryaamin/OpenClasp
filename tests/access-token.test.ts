import { describe, expect, it } from 'vitest';
import {
  agentAccessTokenClientId,
  agentAccessTokenId,
  createAgentAccessToken,
  matchesAgentAccessToken,
} from '../packages/persistence/src/access-token.js';

describe('agent access tokens', () => {
  it('creates opaque bearer credentials whose secret is never needed for lookup', () => {
    const created = createAgentAccessToken();
    expect(created.token).toMatch(/^oc_at_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(agentAccessTokenId(created.token)).toBe(created.tokenId);
    expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(matchesAgentAccessToken(created.token, created.tokenHash)).toBe(true);
    expect(agentAccessTokenClientId(created.tokenId)).toBe(
      `openclasp-agent-token:${created.tokenId}`,
    );
  });

  it('rejects malformed and tampered credentials', () => {
    const created = createAgentAccessToken();
    expect(agentAccessTokenId('not-a-token')).toBeUndefined();
    expect(matchesAgentAccessToken(`${created.token}x`, created.tokenHash)).toBe(false);
    expect(matchesAgentAccessToken(created.token, '0'.repeat(64))).toBe(false);
  });
});
