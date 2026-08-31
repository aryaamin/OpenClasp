import { describe, expect, it } from 'vitest';
import {
  HOSTED_MIGRATIONS,
  buildSourceRecordEnvelope,
  shouldJournalSourceRecord,
} from '@openclasp/persistence';
import {
  LiveSessionStateRecordSchema,
  SourceRecordEnvelopeSchema,
  canonicalHash,
} from '@openclasp/protocol';

describe('production source record journal', () => {
  it('wraps a hosted record with explicit lineage and stable content integrity', () => {
    const payload = {
      interactionId: '11111111-1111-4111-8111-111111111111',
      agentId: 'agent:provider',
      outcome: 'success',
      completedAt: '2026-08-31T10:15:00.000Z',
      contributionMode: 'local_only',
    };
    const source = buildSourceRecordEnvelope({
      operatorId: 'operator:buyer',
      kind: 'completion_report',
      recordId: 'report:1',
      payload,
      metadata: {
        eventId: '22222222-2222-4222-8222-222222222222',
        ingestedAt: '2026-08-31T10:16:00.000Z',
      },
    });

    expect(SourceRecordEnvelopeSchema.parse(source)).toEqual(source);
    expect(source.payloadDigest).toBe(canonicalHash(payload));
    expect(source.reportedAt).toBe(payload.completedAt);
    expect(source.ingestedAt).toBe('2026-08-31T10:16:00.000Z');
    expect(source.entityRefs).toEqual({
      agentId: 'agent:provider',
      interactionId: payload.interactionId,
    });
    expect(source.learningScope).toBe('local_only');
    expect(source.retentionClass).toBe('audit');
    expect(source.provenance).toBe('observed');
    expect(source.visibility).toBe('shared_participants');
  });

  it('uses canonical payload digests and permits explicit collection metadata', () => {
    const base = {
      operatorId: 'operator:one',
      kind: 'agent_profile',
      recordId: 'agent:one',
      metadata: {
        eventId: '33333333-3333-4333-8333-333333333333',
        reportedAt: '2026-08-31T00:00:00.000Z',
        ingestedAt: '2026-08-31T00:00:01.000Z',
        provenance: 'operator_attested' as const,
        visibility: 'shared_participants' as const,
        entityRefs: { deploymentId: 'deployment:one' },
      },
    };
    const left = buildSourceRecordEnvelope({ ...base, payload: { b: 2, a: 1 } });
    const right = buildSourceRecordEnvelope({ ...base, payload: { a: 1, b: 2 } });

    expect(left.payloadDigest).toBe(right.payloadDigest);
    expect(left.retentionClass).toBe('account');
    expect(left.provenance).toBe('operator_attested');
    expect(left.visibility).toBe('shared_participants');
    expect(left.entityRefs.deploymentId).toBe('deployment:one');
  });

  it('rejects values that cannot be retained as JSON', () => {
    expect(() =>
      buildSourceRecordEnvelope({
        operatorId: 'operator:one',
        kind: 'event',
        recordId: 'event:one',
        payload: { invalid: undefined },
      }),
    ).toThrow();
  });

  it('keeps hosted migrations numbered, ordered, and uniquely named', () => {
    expect(HOSTED_MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3]);
    expect(new Set(HOSTED_MIGRATIONS.map((migration) => migration.name)).size).toBe(
      HOSTED_MIGRATIONS.length,
    );
  });

  it('journals intelligence inputs but not high-volume operational projections', () => {
    expect(shouldJournalSourceRecord('completion_report')).toBe(true);
    expect(shouldJournalSourceRecord('interaction_feedback')).toBe(true);
    expect(shouldJournalSourceRecord('federated_interaction')).toBe(true);
    expect(shouldJournalSourceRecord('live_session_event')).toBe(true);
    expect(shouldJournalSourceRecord('live_session_state')).toBe(true);
    expect(shouldJournalSourceRecord('profile_delta')).toBe(true);
    expect(shouldJournalSourceRecord('presence')).toBe(false);
    expect(shouldJournalSourceRecord('profile')).toBe(false);
    expect(shouldJournalSourceRecord('feedback_request')).toBe(false);
  });

  it('keeps live-session state useful without retaining endpoints or raw errors', () => {
    const state = {
      interactionId: '11111111-1111-4111-8111-111111111111',
      initiatorAgentId: 'agent:buyer',
      responderAgentId: 'agent:provider',
      status: 'failed',
      expiresAt: '2026-08-31T10:30:00.000Z',
      createdAt: '2026-08-31T10:00:00.000Z',
      failureCode: 'session_failed',
    } as const;

    expect(LiveSessionStateRecordSchema.parse(state)).toEqual(state);
    expect(() =>
      LiveSessionStateRecordSchema.parse({ ...state, lastError: 'secret upstream response' }),
    ).toThrow();
    expect(() =>
      LiveSessionStateRecordSchema.parse({ ...state, initiatorEndpoint: 'https://private.test' }),
    ).toThrow();
  });
});
