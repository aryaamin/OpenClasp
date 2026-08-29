import { describe, expect, it } from 'vitest';
import {
  decryptGatewayPayload,
  encryptGatewayPayload,
  attestSessionRecord,
  getSessionVerificationKey,
  issueGatewayGrant,
  issueSessionGrant,
  verifyGatewayGrant,
  verifySessionGrant,
  verifySessionRecordAttestation,
} from '../packages/persistence/src/relay.js';

describe('hosted runtime and session cryptography', () => {
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

  it('issues platform-signed live-session credentials', () => {
    const token = issueSessionGrant(secret, {
      interactionId: 'interaction-1',
      senderAgentId: 'agent-a',
      recipientAgentId: 'agent-b',
      expiresAt: Date.now() + 60_000,
    });
    expect(verifySessionGrant(secret, token)).toMatchObject({
      interactionId: 'interaction-1',
      senderAgentId: 'agent-a',
      recipientAgentId: 'agent-b',
    });
    expect(() => verifySessionGrant(secret, `${token}x`)).toThrow(
      'Invalid live-session credential',
    );
  });

  it('attests structured records and rejects changed outcomes', () => {
    const report = { interactionId: 'interaction-1', outcome: 'success' };
    const attestation = attestSessionRecord(secret, report);
    const publicKey = getSessionVerificationKey(secret);
    expect(verifySessionRecordAttestation(publicKey, report, attestation)).toBe(true);
    expect(
      verifySessionRecordAttestation(publicKey, { ...report, outcome: 'failure' }, attestation),
    ).toBe(false);
  });
});
