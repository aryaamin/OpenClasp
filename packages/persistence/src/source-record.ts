import { randomUUID } from 'node:crypto';
import {
  LearningScopeSchema,
  ProvenanceSchema,
  SourceRecordEnvelopeSchema,
  canonicalHash,
  type LearningScope,
  type RetentionClass,
  type SourceRecordEnvelope,
} from '../../protocol/src/index.js';

export type SourceRecordMetadata = Partial<
  Pick<
    SourceRecordEnvelope,
    | 'eventId'
    | 'schemaName'
    | 'schemaVersion'
    | 'entityRefs'
    | 'provenance'
    | 'visibility'
    | 'retentionClass'
    | 'learningScope'
    | 'reportedAt'
    | 'ingestedAt'
  >
>;

export type SourceRecordWriteMetadata = SourceRecordMetadata & { journal?: boolean };

export const SOURCE_JOURNAL_RECORD_KINDS = new Set([
  'agent',
  'agent_profile',
  'completion_report',
  'conflict',
  'consent',
  'contract',
  'counterparty_brief',
  'delegation',
  'event',
  'feedback',
  'interaction',
  'interaction_conclusion',
  'interaction_feedback',
  'learning_eligibility',
  'federated_interaction',
  'live_session_event',
  'live_session_state',
  'profile_delta',
  'receipt',
  'revocation',
  'shield_case',
  'shield_consultation',
  'shield_outcome',
]);

export function shouldJournalSourceRecord(kind: string): boolean {
  return SOURCE_JOURNAL_RECORD_KINDS.has(kind);
}

const ACCOUNT_RECORD_KINDS = new Set([
  'agent_profile',
  'installation',
  'presence',
  'project',
  'publication',
  'setup_request',
]);

const OPERATIONAL_RECORD_KINDS = new Set(['counterparty_brief', 'feedback_request', 'profile']);

const SHARED_RECORD_KINDS = new Set([
  'completion_report',
  'contract',
  'federated_interaction',
  'interaction_conclusion',
  'learning_eligibility',
  'live_session_event',
  'live_session_state',
  'receipt',
]);

const ENTITY_REFERENCE_FIELDS = [
  'agentId',
  'caseId',
  'contractHash',
  'counterpartyAgentId',
  'decisionId',
  'deploymentId',
  'interactionId',
  'consultationId',
  'outcomeId',
  'projectId',
  'reportId',
  'reportingAgentId',
  'requestId',
  'reviewerAgentId',
  'subjectAgentId',
] as const;

const REPORTED_AT_FIELDS = [
  'occurredAt',
  'completedAt',
  'decidedAt',
  'appliedAt',
  'generatedAt',
  'createdAt',
  'requestedAt',
  'updatedAt',
] as const;

function payloadObject(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

function defaultRetentionClass(kind: string): RetentionClass {
  if (ACCOUNT_RECORD_KINDS.has(kind)) return 'account';
  if (OPERATIONAL_RECORD_KINDS.has(kind)) return 'operational';
  return 'audit';
}

function inferredEntityRefs(payload: unknown): Record<string, string> {
  const object = payloadObject(payload);
  if (!object) return {};
  return Object.fromEntries(
    ENTITY_REFERENCE_FIELDS.flatMap((field) => {
      const value = object[field];
      return typeof value === 'string' && value ? [[field, value]] : [];
    }),
  );
}

function inferredProvenance(payload: unknown): SourceRecordEnvelope['provenance'] {
  const value = payloadObject(payload)?.provenance;
  const parsed = ProvenanceSchema.safeParse(value);
  return parsed.success ? parsed.data : 'observed';
}

function inferredLearningScope(payload: unknown): LearningScope {
  const object = payloadObject(payload);
  const candidate = object?.contributionMode ?? object?.learningScope;
  const parsed = LearningScopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : 'not_evaluated';
}

function inferredReportedAt(payload: unknown, fallback: string): string {
  const object = payloadObject(payload);
  if (!object) return fallback;
  for (const field of REPORTED_AT_FIELDS) {
    const value = object[field];
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  }
  return fallback;
}

export function buildSourceRecordEnvelope(input: {
  operatorId: string;
  kind: string;
  recordId: string;
  payload: unknown;
  metadata?: SourceRecordMetadata;
}): SourceRecordEnvelope {
  const ingestedAt = input.metadata?.ingestedAt ?? new Date().toISOString();
  return SourceRecordEnvelopeSchema.parse({
    eventId: input.metadata?.eventId ?? randomUUID(),
    operatorId: input.operatorId,
    kind: input.kind,
    recordId: input.recordId,
    schemaName: input.metadata?.schemaName ?? `openclasp.${input.kind}`,
    schemaVersion: input.metadata?.schemaVersion ?? '1',
    payload: input.payload,
    payloadDigest: canonicalHash(input.payload),
    entityRefs: {
      ...inferredEntityRefs(input.payload),
      ...input.metadata?.entityRefs,
    },
    provenance: input.metadata?.provenance ?? inferredProvenance(input.payload),
    visibility:
      input.metadata?.visibility ??
      (SHARED_RECORD_KINDS.has(input.kind) ? 'shared_participants' : 'local_only'),
    retentionClass: input.metadata?.retentionClass ?? defaultRetentionClass(input.kind),
    learningScope: input.metadata?.learningScope ?? inferredLearningScope(input.payload),
    reportedAt: input.metadata?.reportedAt ?? inferredReportedAt(input.payload, ingestedAt),
    ingestedAt,
  });
}
