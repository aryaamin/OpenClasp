import { describe, expect, it } from 'vitest';
import {
  decryptGatewayPayload,
  encryptGatewayPayload,
  issueGatewayGrant,
  verifyGatewayGrant,
} from '../packages/persistence/src/relay.js';

describe('hosted A2A gateway cryptography', () => {
  const secret = 'a-test-secret-that-is-at-least-thirty-two-bytes';

  it('encrypts message bodies and detects tampering', () => {
    const encrypted = encryptGatewayPayload(secret, { message: 'private task' });
    expect(JSON.stringify(encrypted)).not.toContain('private task');
    expect(decryptGatewayPayload(secret, encrypted)).toEqual({ message: 'private task' });
    expect(() =>
      decryptGatewayPayload(secret, { ...encrypted, ciphertext: `${encrypted.ciphertext}x` }),
    ).toThrow();
  });

  it('issues scoped, expiring delivery grants', () => {
    const token = issueGatewayGrant(secret, {
      interactionId: 'interaction-1',
      senderAgentId: 'agent-a',
      recipientAgentId: 'agent-b',
      expiresAt: Date.now() + 60_000,
    });
    expect(verifyGatewayGrant(secret, token).recipientAgentId).toBe('agent-b');
    expect(() => verifyGatewayGrant(secret, `${token}x`)).toThrow('Invalid gateway token');
  });
});
