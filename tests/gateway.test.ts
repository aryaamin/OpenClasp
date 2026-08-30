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
import {
  ContractRevisionSchema,
  canonicalHash,
  verifyRecordAttestation,
} from '../packages/protocol/src/index.js';

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

  it('creates a verifiable, hash-linked accepted contract revision', () => {
    const interactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const now = '2026-08-30T00:00:00.000Z';
    const contract = {
      protocolVersion: '0.1' as const,
      interactionId,
      purpose: 'Buy paper',
      parties: ['agent-a', 'agent-b'],
      taskCategory: 'procurement',
      requestedOutcome: 'Five tonnes delivered',
      successCriteria: ['80 GSM verified'],
      allowedActions: ['negotiate'],
      prohibitedActions: ['exceed_budget'],
      allowedData: [],
      prohibitedData: ['credentials'],
      evidenceRequirements: ['invoice'],
      delegationRules: ['explicit_contract_scope'],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent' as const,
      retentionDays: 30,
      completionConditions: ['delivery accepted'],
      cancellationConditions: ['either party before acceptance'],
      signatures: {},
    };
    const termsHash = canonicalHash(contract);
    const base = ContractRevisionSchema.parse({
      revisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      interactionId,
      revision: 2,
      previousTermsHash: 'previous-hash',
      termsHash,
      contract,
      proposedByAgentId: 'agent-b',
      status: 'accepted',
      acceptances: {
        'agent-a': {
          agentId: 'agent-a',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
        'agent-b': {
          agentId: 'agent-b',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    const revision = ContractRevisionSchema.parse({
      ...base,
      platformAttestation: attestSessionRecord(secret, base),
    });
    const publicKey = getSessionVerificationKey(secret);
    expect(verifyRecordAttestation(revision, publicKey)).toBe(true);
    expect(verifyRecordAttestation({ ...revision, termsHash: 'tampered' }, publicKey)).toBe(false);
  });
});
