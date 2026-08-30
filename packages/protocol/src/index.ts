import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

export const PROTOCOL_VERSION = '0.1' as const;
export const DEFAULT_EXTENSION_URI = 'https://openclasp.vercel.app/extensions/trust/v0.1';

export const ProvenanceSchema = z.enum([
  'self_declared',
  'operator_attested',
  'cryptographically_verified',
  'domain_verified',
  'third_party_verified',
  'observed',
  'disputed',
]);
export const VisibilitySchema = z.enum([
  'local_only',
  'private_requester',
  'private_responder',
  'shared_participants',
  'network_aggregate',
]);
export const DataSharingModeSchema = z.enum([
  'local_only',
  'structured_only',
  'permitted_evidence',
]);
export const SignatureSchema = z.object({
  algorithm: z.literal('Ed25519'),
  keyId: z.string().min(1),
  value: z.string().min(1),
});

export const RecordAttestationSchema = SignatureSchema.extend({
  digest: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
}).strict();

export const ExpectationManifestSchema = z.object({
  requiredInputs: z.array(z.string()).default([]),
  supportedTaskCategories: z.array(z.string()).min(1),
  responseTimeMs: z.number().int().positive().optional(),
  dataRequirements: z.array(z.string()).default([]),
  prohibitedData: z.array(z.string()).default([]),
  humanApprovalThresholds: z.array(z.string()).default([]),
  delegationPolicy: z.string().default('explicit'),
  evidenceRequirements: z.array(z.string()).default([]),
  factCheckingPreference: z
    .enum(['none', 'important_claims', 'all_objective_claims'])
    .default('important_claims'),
  mediationPreference: z.enum(['never', 'mutual_consent']).default('mutual_consent'),
  retentionDays: z.number().int().nonnegative().default(30),
  communicationFormats: z.array(z.string()).default(['text/plain']),
  cancellationPolicy: z.string().default('either_party'),
  provenance: ProvenanceSchema,
});

export const AgentIdentitySchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  agentId: z.string().min(1),
  publicKey: z.string().min(1),
  keyId: z.string().min(1),
  operatorRef: z.string().min(1),
  assurance: z.enum(['pseudonymous', 'domain_associated', 'organization_associated']),
  agentVersion: z.string().min(1),
  capabilities: z.array(z.string()),
  supportedProtocols: z.array(z.string()),
  parentAgentId: z.string().optional(),
  rootControllerId: z.string().min(1),
  revoked: z.boolean().default(false),
  provenance: ProvenanceSchema,
  createdAt: z.string().datetime(),
  signature: SignatureSchema.optional(),
});

export const DelegationCredentialSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  delegationId: z.string().uuid(),
  parentAgentId: z.string(),
  childAgentId: z.string(),
  rootControllerId: z.string(),
  capabilities: z.array(z.string()).min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revoked: z.boolean().default(false),
  signature: SignatureSchema.optional(),
});

export const InteractionContractSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  interactionId: z.string().uuid(),
  purpose: z.string(),
  parties: z.array(z.string()).min(1),
  taskCategory: z.string(),
  requestedOutcome: z.string(),
  successCriteria: z.array(z.string()),
  allowedActions: z.array(z.string()),
  prohibitedActions: z.array(z.string()),
  allowedData: z.array(z.string()),
  prohibitedData: z.array(z.string()),
  deadline: z.string().datetime().optional(),
  evidenceRequirements: z.array(z.string()),
  delegationRules: z.array(z.string()),
  humanApprovalRequirements: z.array(z.string()),
  factCheckingPolicy: z.string(),
  mediationPolicy: z.enum(['none', 'mutual_consent']),
  retentionDays: z.number().int().nonnegative(),
  completionConditions: z.array(z.string()),
  cancellationConditions: z.array(z.string()),
  signatures: z.record(z.string(), SignatureSchema).default({}),
});

export const AgentTransportSchema = z.object({
  protocol: z.literal('A2A/1.0'),
  protocolBinding: z.string().min(1).default('JSONRPC'),
  endpoint: z.string().url(),
  managedBy: z.enum(['agent', 'openclasp']).default('agent'),
});

export const AgentModeSchema = z.enum(['persistent_runtime', 'temporary_chat']);

export const AgentPresenceSchema = z.object({
  status: z.enum(['online', 'offline']),
  lastSeenAt: z.string().datetime().optional(),
  checkedAt: z.string().datetime(),
});

export const PublicAgentVerificationSchema = z.object({
  status: z.literal('verified'),
  method: z.literal('openclasp_oauth_account'),
  verifiedAt: z.string().datetime(),
  verificationKeyUrl: z.string().url().optional(),
});

export const PublicAgentCardSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  agentId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  framework: z.string().min(1),
  agentVersion: z.string().min(1),
  capabilities: z.array(z.string()),
  limitations: z.array(z.string()),
  assurance: z.enum(['oauth_authenticated', 'cryptographically_verified']),
  agentMode: AgentModeSchema.default('persistent_runtime'),
  transports: z.array(AgentTransportSchema),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  profileUrl: z.string().url().optional(),
  cardUrl: z.string().url(),
  a2aAgentCardUrl: z.string().url(),
  extensionUri: z.string().url(),
  presence: AgentPresenceSchema.optional(),
  verification: PublicAgentVerificationSchema.optional(),
  publishedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  platformAttestation: RecordAttestationSchema.optional(),
});

export const AgentResolutionSchema = z.object({
  reference: z.string().min(1),
  matchedBy: z.enum(['agent_id', 'slug', 'profile_url', 'card_url', 'a2a_card_url']),
  verified: z.literal(true),
  card: PublicAgentCardSchema,
  resolvedAt: z.string().datetime(),
});

export const HostedThreadStatusSchema = z.enum(['open', 'closed']);

export const HostedMessageSchema = z.object({
  messageId: z.string().uuid(),
  threadId: z.string().uuid(),
  interactionId: z.string().uuid(),
  senderAgentId: z.string().min(1),
  recipientAgentId: z.string().min(1),
  contentType: z.literal('text/plain'),
  content: z.string().min(1).max(20_000),
  contentHash: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  delivery: z.enum(['accepted', 'delivered', 'read']),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().optional(),
});

export const HostedThreadSchema = z.object({
  threadId: z.string().uuid(),
  interactionId: z.string().uuid(),
  participantAgentIds: z.tuple([z.string().min(1), z.string().min(1)]),
  status: HostedThreadStatusSchema,
  privacyMode: z.literal('openclasp_hosted_temporary'),
  unreadCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const ContractAcceptanceSchema = z.object({
  agentId: z.string().min(1),
  method: z.enum(['oauth_installation', 'oauth_account', 'policy_auto_accept', 'ed25519']),
  termsHash: z.string().min(1),
  acceptedAt: z.string().datetime(),
  signature: SignatureSchema.optional(),
});

export const ContractRevisionSchema = z.object({
  revisionId: z.string().uuid(),
  interactionId: z.string().uuid(),
  revision: z.number().int().positive(),
  previousTermsHash: z.string().min(1).optional(),
  termsHash: z.string().min(1),
  contract: InteractionContractSchema,
  proposedByAgentId: z.string().min(1),
  status: z.enum(['proposed', 'accepted', 'rejected', 'superseded']),
  acceptances: z.record(z.string(), ContractAcceptanceSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  platformAttestation: RecordAttestationSchema.optional(),
});

export const FederatedInteractionStatusSchema = z.enum([
  'pending',
  'active',
  'rejected',
  'expired',
  'cancelled',
  'completed',
]);

export const FederatedInteractionSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  interactionId: z.string().uuid(),
  initiatorAgentId: z.string().min(1),
  responderAgentId: z.string().min(1),
  status: FederatedInteractionStatusSchema,
  contract: InteractionContractSchema,
  termsHash: z.string().min(1),
  acceptances: z.record(z.string(), ContractAcceptanceSchema),
  contractRevision: z.number().int().positive().default(1),
  contractRevisions: z.array(ContractRevisionSchema).default([]),
  initiatorTransport: AgentTransportSchema.optional(),
  responderTransport: AgentTransportSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const LiveSessionInsightSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(['info', 'caution', 'high']),
    message: z.string().min(1),
    evidenceReferences: z.array(z.string()).default([]),
    requirementReferences: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const RequirementAssessmentSchema = z
  .object({
    requirementId: z.string().min(1).max(128),
    requirement: z.string().min(1).max(1000),
    kind: z.enum([
      'capability',
      'limitation',
      'success_criterion',
      'deadline',
      'evidence',
      'scope',
      'data',
      'communication',
      'delegation',
    ]),
    status: z.enum(['match', 'partial', 'mismatch', 'unknown']),
    reason: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
    sources: z
      .array(
        z.enum(['contract', 'self_declared', 'eligible_history', 'evidence', 'version_change']),
      )
      .min(1),
    evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
  })
  .strict();

export const CounterpartyBriefSchema = z
  .object({
    briefId: z.string().uuid(),
    interactionId: z.string().uuid(),
    contractHash: z.string().min(1),
    recipientAgentId: z.string().min(1),
    subjectAgentId: z.string().min(1),
    taskCategory: z.string().min(1),
    decision: z.enum(['ALLOW', 'CHALLENGE', 'DENY']),
    requirements: z.array(RequirementAssessmentSchema).max(100),
    insights: z.array(LiveSessionInsightSchema).max(100),
    relevantSampleSize: z.number().int().nonnegative(),
    historyConfidence: z.number().min(0).max(1),
    subjectAgentVersion: z.string().min(1),
    recommendedContractChanges: z.array(z.string().min(1).max(1000)).max(50).default([]),
    generatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    signature: SignatureSchema.optional(),
  })
  .strict()
  .refine((brief) => brief.recipientAgentId !== brief.subjectAgentId, {
    message: 'A counterparty brief must describe another agent',
    path: ['subjectAgentId'],
  })
  .refine((brief) => Date.parse(brief.expiresAt) > Date.parse(brief.generatedAt), {
    message: 'Counterparty brief expiry must be after generation',
    path: ['expiresAt'],
  });

export const LiveSessionOfferSchema = z.object({
  type: z.literal('openclasp.session.offer'),
  version: z.literal('1'),
  offerId: z.string().uuid(),
  interactionId: z.string().uuid(),
  agentId: z.string().min(1),
  role: z.enum(['initiator', 'responder']),
  counterparty: z.object({
    agentId: z.string().min(1),
    name: z.string().min(1),
    agentVersion: z.string().min(1),
    capabilities: z.array(z.string()),
  }),
  contract: InteractionContractSchema,
  contractHash: z.string().min(1),
  privateInsights: z.array(LiveSessionInsightSchema).default([]),
  counterpartyBrief: CounterpartyBriefSchema.optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const LiveSessionAcceptanceSchema = z.object({
  type: z.literal('openclasp.session.accepted'),
  version: z.literal('1'),
  offerId: z.string().uuid(),
  interactionId: z.string().uuid(),
  agentId: z.string().min(1),
  sessionId: z.string().uuid(),
  a2aEndpoint: z.string().url(),
  expiresAt: z.string().datetime(),
});

export const LiveSessionActivationSchema = z.object({
  type: z.literal('openclasp.session.activation'),
  version: z.literal('1'),
  activationId: z.string().uuid(),
  interactionId: z.string().uuid(),
  agentId: z.string().min(1),
  sessionId: z.string().uuid(),
  role: z.enum(['initiator', 'responder']),
  peer: z.object({
    agentId: z.string().min(1),
    sessionId: z.string().uuid(),
    endpoint: z.string().url(),
    bearerToken: z.string().min(1),
    verificationKey: z.string().min(1),
  }),
  reporting: z.object({
    endpoint: z.string().url(),
    completionEndpoint: z.string().url().optional(),
    feedbackEndpoint: z.string().url().optional(),
    bearerToken: z.string().min(1),
  }),
  privateInsights: z.array(LiveSessionInsightSchema).optional(),
  counterpartyBrief: CounterpartyBriefSchema.optional(),
  contractHash: z.string().min(1),
  activatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const SessionDetailKeySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/);

export const StructuredSessionDetailsSchema = z
  .object({
    labels: z.array(SessionDetailKeySchema).max(32).default([]),
    metrics: z.record(SessionDetailKeySchema, z.number().finite()).default({}),
    flags: z.record(SessionDetailKeySchema, z.boolean()).default({}),
  })
  .strict()
  .default({ labels: [], metrics: {}, flags: {} });

export const ProgressCheckpointSchema = z
  .object({
    state: z.enum(['active', 'blocked', 'ready_to_finalize', 'done', 'cancelled']),
    progress: z.number().min(0).max(1),
    criteriaMet: z.array(z.string().min(1).max(1000)).max(100).default([]),
    criteriaRemaining: z.array(z.string().min(1).max(1000)).max(100).default([]),
    blockerCodes: z.array(SessionDetailKeySchema).max(32).default([]),
    topicStatus: z.enum(['in_scope', 'drifting', 'changed']),
    expectedRemainingTurns: z.number().int().nonnegative().max(1000).optional(),
    needsHuman: z.boolean().default(false),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const LiveSessionEventSchema = z
  .object({
    eventId: z.string().uuid(),
    interactionId: z.string().uuid(),
    agentId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    type: z.enum([
      'session_started',
      'message_sent',
      'progress_checkpoint',
      'claim',
      'evidence',
      'correction',
      'constraint',
      'task_result',
      'session_completed',
      'session_failed',
    ]),
    occurredAt: z.string().datetime(),
    messageHash: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{43}$/)
      .optional(),
    evidenceReferences: z.array(z.string()).default([]),
    outcome: z.enum(['success', 'failure', 'partial']).optional(),
    checkpoint: ProgressCheckpointSchema.optional(),
    details: StructuredSessionDetailsSchema,
  })
  .superRefine((event, context) => {
    if (event.type === 'progress_checkpoint' && !event.checkpoint)
      context.addIssue({
        code: 'custom',
        path: ['checkpoint'],
        message: 'Progress checkpoint events require structured checkpoint data',
      });
    if (event.type !== 'progress_checkpoint' && event.checkpoint)
      context.addIssue({
        code: 'custom',
        path: ['checkpoint'],
        message: 'Checkpoint data is only valid on progress checkpoint events',
      });
  });

export const CompletionOutcomeSchema = z.enum(['success', 'partial', 'failure', 'cancelled']);

export const SuccessCriterionAssessmentSchema = z
  .object({
    criterion: z.string().min(1).max(1000),
    status: z.enum(['met', 'partially_met', 'missed', 'unknown']),
    explanation: z.string().max(1000).optional(),
    evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
  })
  .strict();

export const InteractionCompletionReportSchema = z
  .object({
    reportId: z.string().uuid(),
    interactionId: z.string().uuid(),
    contractHash: z.string().min(1),
    reportingAgentId: z.string().min(1),
    counterpartyAgentId: z.string().min(1),
    agentVersion: z.string().min(1),
    outcome: CompletionOutcomeSchema,
    summary: z.string().min(1).max(2000),
    requestedOutcome: z.string().min(1).max(1000),
    criteria: z.array(SuccessCriterionAssessmentSchema).max(100),
    deliverables: z.array(z.string().min(1).max(1000)).max(100).default([]),
    actionsTaken: z.array(z.string().min(1).max(1000)).max(100).default([]),
    blockers: z.array(z.string().min(1).max(1000)).max(100).default([]),
    scopeChanges: z.array(z.string().min(1).max(1000)).max(100).default([]),
    corrections: z.array(z.string().min(1).max(1000)).max(100).default([]),
    evidenceReferences: z.array(z.string().min(1).max(2048)).max(100).default([]),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime(),
    confidence: z.number().min(0).max(1),
    dataSharingMode: DataSharingModeSchema.default('structured_only'),
    signature: SignatureSchema.optional(),
    submissionMethod: z
      .enum(['agent_signature', 'oauth_installation', 'agent_access_token', 'runtime_session'])
      .optional(),
    platformAttestation: RecordAttestationSchema.optional(),
  })
  .strict()
  .refine((report) => report.reportingAgentId !== report.counterpartyAgentId, {
    message: 'A completion report must describe an interaction with another agent',
    path: ['counterpartyAgentId'],
  })
  .refine(
    (report) => !report.startedAt || Date.parse(report.completedAt) >= Date.parse(report.startedAt),
    { message: 'Completion cannot precede the start time', path: ['completedAt'] },
  );

export const FeedbackDimensionSchema = z.enum([
  'overall_satisfaction',
  'outcome_satisfaction',
  'communication',
  'timeliness',
  'scope_adherence',
  'evidence_quality',
  'correction_handling',
  'limitation_disclosure',
  'reliability',
]);

export const FeedbackRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    interactionId: z.string().uuid(),
    reviewerAgentId: z.string().min(1),
    subjectAgentId: z.string().min(1),
    status: z.enum(['pending', 'submitted', 'expired', 'waived']),
    requestedDimensions: z.array(FeedbackDimensionSchema).min(1),
    requestedAt: z.string().datetime(),
    dueAt: z.string().datetime(),
    platformAttestation: RecordAttestationSchema.optional(),
  })
  .strict()
  .refine((request) => request.reviewerAgentId !== request.subjectAgentId, {
    message: 'Feedback must concern another agent',
    path: ['subjectAgentId'],
  })
  .refine((request) => Date.parse(request.dueAt) > Date.parse(request.requestedAt), {
    message: 'Feedback due date must follow its request date',
    path: ['dueAt'],
  });

export const InteractionFeedbackSchema = z
  .object({
    feedbackId: z.string().uuid(),
    requestId: z.string().uuid(),
    interactionId: z.string().uuid(),
    reviewerAgentId: z.string().min(1),
    subjectAgentId: z.string().min(1),
    reviewerAgentVersion: z.string().min(1),
    ratings: z.partialRecord(FeedbackDimensionSchema, z.number().min(0).max(1)),
    wouldWorkAgain: z.enum(['yes', 'no', 'unsure']),
    reasonCodes: z.array(z.string().min(1).max(128)).max(32).default([]),
    privateComment: z.string().max(1000).optional(),
    evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
    confidence: z.number().min(0).max(1),
    submittedAt: z.string().datetime(),
    signature: SignatureSchema.optional(),
    submissionMethod: z
      .enum(['agent_signature', 'oauth_installation', 'agent_access_token', 'runtime_session'])
      .optional(),
    platformAttestation: RecordAttestationSchema.optional(),
  })
  .strict()
  .refine((feedback) => feedback.reviewerAgentId !== feedback.subjectAgentId, {
    message: 'Feedback must concern another agent',
    path: ['subjectAgentId'],
  })
  .refine((feedback) => Object.keys(feedback.ratings).length > 0, {
    message: 'At least one feedback rating is required',
    path: ['ratings'],
  });

export const InteractionConclusionSchema = z
  .object({
    conclusionId: z.string().uuid(),
    interactionId: z.string().uuid(),
    contractHash: z.string().min(1),
    outcome: CompletionOutcomeSchema,
    consensus: z.enum([
      'bilateral_agreement',
      'bilateral_partial_agreement',
      'conflicting',
      'unilateral',
      'insufficient',
    ]),
    lifecycle: z.enum(['provisional', 'final']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    missingReportAgentIds: z.array(z.string().min(1)).max(2).optional(),
    pendingFeedbackAgentIds: z.array(z.string().min(1)).max(2).optional(),
    peerReportStatus: z.enum(['awaiting', 'unreachable', 'received', 'timed_out']).optional(),
    summary: z.string().min(1).max(2000),
    criteria: z.array(SuccessCriterionAssessmentSchema).max(100),
    reportIds: z.array(z.string().uuid()).max(2),
    feedbackIds: z.array(z.string().uuid()).max(2),
    averageRatings: z.partialRecord(FeedbackDimensionSchema, z.number().min(0).max(1)).default({}),
    evidenceReferences: z.array(z.string().min(1).max(2048)).max(100).default([]),
    generatedAt: z.string().datetime(),
    platformAttestation: RecordAttestationSchema.optional(),
  })
  .strict();

export const LearningEligibilityDecisionSchema = z
  .object({
    decisionId: z.string().uuid(),
    interactionId: z.string().uuid(),
    eligible: z.boolean(),
    reasons: z.array(z.string().min(1).max(500)).min(1).max(50),
    sampleWeight: z.number().min(0).max(1),
    reportIds: z.array(z.string().uuid()).max(2),
    feedbackIds: z.array(z.string().uuid()).max(2),
    evidenceReferences: z.array(z.string().min(1).max(2048)).max(100).default([]),
    manipulationSignals: z.array(z.string().min(1).max(128)).max(20).default([]),
    contributionMode: z.enum(['local_only', 'network_aggregate']),
    structuredDataOnly: z.literal(true),
    decidedAt: z.string().datetime(),
    platformAttestation: RecordAttestationSchema.optional(),
  })
  .strict();

export const BehaviouralProfileDeltaSchema = z
  .object({
    deltaId: z.string().uuid(),
    interactionId: z.string().uuid(),
    agentId: z.string().min(1),
    agentVersion: z.string().min(1),
    taskCategory: z.string().min(1),
    sampleWeight: z.number().min(0).max(1),
    dimensionDeltas: z.record(z.string().min(1).max(128), z.number().min(-1).max(1)),
    explanation: z.string().min(1).max(2000),
    appliedAt: z.string().datetime(),
    platformAttestation: RecordAttestationSchema.optional(),
  })
  .strict();

export const BehaviouralDimensionNameSchema = z.enum([
  'completion',
  'acceptance',
  'specification',
  'deadline',
  'communication',
  'evidence',
  'scope',
  'correction',
  'limitations',
  'disputes',
]);

export const ContextualReliabilitySummarySchema = z
  .object({
    agentId: z.string().min(1),
    agentVersion: z.string().min(1),
    taskCategory: z.string().min(1),
    score: z.number().min(0).max(1),
    confidence: z.object({
      level: z.enum(['low', 'medium', 'high']),
      value: z.number().min(0).max(1),
      evidenceCount: z.number().int().nonnegative(),
      effectiveSampleSize: z.number().nonnegative(),
    }),
    trend: z.object({
      direction: z.enum(['improving', 'stable', 'declining']),
      delta: z.number().min(-1).max(1),
    }),
    strengths: z
      .array(
        z.object({
          dimension: BehaviouralDimensionNameSchema,
          score: z.number().min(0).max(1),
        }),
      )
      .max(3),
    risks: z
      .array(
        z.object({
          dimension: BehaviouralDimensionNameSchema,
          score: z.number().min(0).max(1),
          reason: z.string().min(1).max(300),
        }),
      )
      .max(3),
    versionStatus: z.object({
      currentVersion: z.string().min(1),
      evidenceVersion: z.string().min(1),
      status: z.enum(['current', 'reduced_confidence']),
    }),
    source: z.literal('private_verified_history'),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const TrustEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  interactionId: z.string().uuid(),
  requestingAgentId: z.string(),
  respondingAgentId: z.string(),
  rootControllerId: z.string(),
  parentAgentId: z.string().optional(),
  agentVersion: z.string(),
  delegationId: z.string().uuid().optional(),
  requestedCapability: z.string(),
  taskCategory: z.string(),
  contractHash: z.string(),
  dataSharingMode: DataSharingModeSchema,
  evidenceRequirements: z.array(z.string()),
  timestamp: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(12),
  signature: SignatureSchema.optional(),
});

export const EventTypeSchema = z.enum([
  'claim',
  'evidence',
  'constraint',
  'commitment',
  'proposal',
  'objection',
  'policy_warning',
  'policy_violation',
  'private_suggestion',
  'shared_intervention',
  'delegation',
  'task_result',
  'resolution',
  'receipt',
  'feedback',
  'dispute',
]);
export const InteractionEventSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: z.string().uuid(),
  interactionId: z.string().uuid(),
  eventType: EventTypeSchema,
  agentId: z.string(),
  agentVersion: z.string(),
  timestamp: z.string().datetime(),
  visibility: VisibilitySchema,
  provenance: ProvenanceSchema,
  payloadHash: z.string(),
  payload: z.record(z.string(), z.unknown()),
  evidenceRefs: z.array(z.string()).optional(),
  signature: SignatureSchema.optional(),
});

export const FeedbackSchema = z.object({
  feedbackId: z.string().uuid(),
  interactionId: z.string().uuid(),
  receiptId: z.string().uuid(),
  reviewerAgentId: z.string(),
  subjectAgentId: z.string(),
  taskCompleted: z.boolean(),
  outputAccepted: z.boolean(),
  specificationMatched: z.boolean(),
  deadlineMet: z.boolean(),
  communicationQuality: z.number().min(0).max(1),
  evidenceProvided: z.boolean(),
  scopeRespected: z.boolean(),
  disputeRaised: z.boolean(),
  comment: z.string().max(1000).optional(),
  submittedAt: z.string().datetime(),
  signature: SignatureSchema.optional(),
});

export const ReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  interactionId: z.string().uuid(),
  participants: z.array(z.string()),
  agentVersions: z.record(z.string(), z.string()),
  contractHash: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  outcome: z.enum(['success', 'partial', 'failure', 'cancelled']),
  commitmentsFulfilled: z.array(z.string()),
  commitmentsMissed: z.array(z.string()),
  evidenceHashes: z.array(z.string()),
  policyWarnings: z.array(z.string()),
  policyViolations: z.array(z.string()),
  disputeStatus: z.enum(['none', 'open', 'resolved']),
  delegationChainHash: z.string(),
  unilateral: z.boolean(),
  provisional: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  signatures: z.record(z.string(), SignatureSchema).default({}),
  completionReportIds: z.array(z.string().uuid()).max(2).optional(),
  conclusionId: z.string().uuid().optional(),
  platformAttestation: RecordAttestationSchema.optional(),
});

export const RiskDecisionSchema = z.object({
  decision: z.enum(['ALLOW', 'CHALLENGE', 'DENY']),
  confidence: z.number().min(0).max(1),
  taskCategory: z.string(),
  sampleSize: z.number().int().nonnegative(),
  dimensions: z.record(z.string(), z.number()),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  dataFreshness: z.record(z.string(), z.string()),
  requiredChallenges: z.array(z.string()),
});

export const FactCheckResultSchema = z.object({
  claim: z.string(),
  claimType: z.enum(['objective', 'subjective', 'prediction']),
  status: z.enum([
    'verified',
    'supported',
    'contradicted',
    'unverified',
    'not_fact_checkable',
    'insufficient_permission',
  ]),
  confidence: z.number().min(0).max(1),
  evidenceReferences: z.array(z.string()),
  sourceAuthority: z.string(),
  sourceFreshness: z.string(),
  contradictingEvidence: z.array(z.string()),
  suggestedNextAction: z.string(),
});

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type DelegationCredential = z.infer<typeof DelegationCredentialSchema>;
export type InteractionContract = z.infer<typeof InteractionContractSchema>;
export type TrustEnvelope = z.infer<typeof TrustEnvelopeSchema>;
export type InteractionEvent = z.infer<typeof InteractionEventSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
export type FactCheckResult = z.infer<typeof FactCheckResultSchema>;
export type ExpectationManifest = z.infer<typeof ExpectationManifestSchema>;
export type AgentTransport = z.infer<typeof AgentTransportSchema>;
export type AgentMode = z.infer<typeof AgentModeSchema>;
export type AgentPresence = z.infer<typeof AgentPresenceSchema>;
export type PublicAgentVerification = z.infer<typeof PublicAgentVerificationSchema>;
export type PublicAgentCard = z.infer<typeof PublicAgentCardSchema>;
export type AgentResolution = z.infer<typeof AgentResolutionSchema>;
export type HostedMessage = z.infer<typeof HostedMessageSchema>;
export type HostedThread = z.infer<typeof HostedThreadSchema>;
export type ContractAcceptance = z.infer<typeof ContractAcceptanceSchema>;
export type ContractRevision = z.infer<typeof ContractRevisionSchema>;
export type FederatedInteraction = z.infer<typeof FederatedInteractionSchema>;
export type LiveSessionInsight = z.infer<typeof LiveSessionInsightSchema>;
export type LiveSessionOffer = z.infer<typeof LiveSessionOfferSchema>;
export type LiveSessionAcceptance = z.infer<typeof LiveSessionAcceptanceSchema>;
export type LiveSessionActivation = z.infer<typeof LiveSessionActivationSchema>;
export type LiveSessionEvent = z.infer<typeof LiveSessionEventSchema>;
export type RequirementAssessment = z.infer<typeof RequirementAssessmentSchema>;
export type CounterpartyBrief = z.infer<typeof CounterpartyBriefSchema>;
export type CompletionOutcome = z.infer<typeof CompletionOutcomeSchema>;
export type SuccessCriterionAssessment = z.infer<typeof SuccessCriterionAssessmentSchema>;
export type InteractionCompletionReport = z.infer<typeof InteractionCompletionReportSchema>;
export type FeedbackDimension = z.infer<typeof FeedbackDimensionSchema>;
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
export type InteractionFeedback = z.infer<typeof InteractionFeedbackSchema>;
export type InteractionConclusion = z.infer<typeof InteractionConclusionSchema>;
export type LearningEligibilityDecision = z.infer<typeof LearningEligibilityDecisionSchema>;
export type BehaviouralProfileDelta = z.infer<typeof BehaviouralProfileDeltaSchema>;
export type BehaviouralDimensionName = z.infer<typeof BehaviouralDimensionNameSchema>;
export type ContextualReliabilitySummary = z.infer<typeof ContextualReliabilitySummarySchema>;
export type RecordAttestation = z.infer<typeof RecordAttestationSchema>;

export interface KeyPair {
  keyId: string;
  publicKey: string;
  privateKey: string;
}

export function createKeyPair(keyId: string = randomUUID()): KeyPair {
  const pair = generateKeyPairSync('ed25519');
  return {
    keyId,
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
  };
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('base64url');
}

export function verifyRecordAttestation(
  value: Record<string, unknown>,
  publicKey: string,
): boolean {
  const attestation = RecordAttestationSchema.safeParse(value.platformAttestation);
  if (!attestation.success) return false;
  const unsignedValue = structuredClone(value);
  delete unsignedValue.platformAttestation;
  const digest = canonicalHash(unsignedValue);
  if (digest !== attestation.data.digest) return false;
  return verify(
    null,
    Buffer.from(digest),
    {
      key: Buffer.from(publicKey, 'base64url'),
      type: 'spki',
      format: 'der',
    },
    Buffer.from(attestation.data.value, 'base64url'),
  );
}

function unsigned(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value);
  delete copy.signature;
  delete copy.signatures;
  return copy;
}

export function signObject<T extends Record<string, unknown>>(
  value: T,
  key: KeyPair,
): T & { signature: z.infer<typeof SignatureSchema> } {
  const payload = Buffer.from(canonicalize(unsigned(value)));
  const privateKey = {
    key: Buffer.from(key.privateKey, 'base64url'),
    type: 'pkcs8' as const,
    format: 'der' as const,
  };
  return {
    ...value,
    signature: {
      algorithm: 'Ed25519',
      keyId: key.keyId,
      value: sign(null, payload, privateKey).toString('base64url'),
    },
  };
}

export function verifyObject(value: Record<string, unknown>, publicKey: string): boolean {
  const parsed = SignatureSchema.safeParse(value.signature);
  if (!parsed.success) return false;
  const key = {
    key: Buffer.from(publicKey, 'base64url'),
    type: 'spki' as const,
    format: 'der' as const,
  };
  return verify(
    null,
    Buffer.from(canonicalize(unsigned(value))),
    key,
    Buffer.from(parsed.data.value, 'base64url'),
  );
}

export function signNamed<T extends Record<string, unknown>>(
  value: T,
  signerId: string,
  key: KeyPair,
): T & { signatures: Record<string, z.infer<typeof SignatureSchema>> } {
  const payload = Buffer.from(canonicalize(unsigned(value)));
  const privateKey = {
    key: Buffer.from(key.privateKey, 'base64url'),
    type: 'pkcs8' as const,
    format: 'der' as const,
  };
  const signature = {
    algorithm: 'Ed25519' as const,
    keyId: key.keyId,
    value: sign(null, payload, privateKey).toString('base64url'),
  };
  return {
    ...value,
    signatures: { ...((value.signatures as object) ?? {}), [signerId]: signature },
  };
}

export function verifyNamed(
  value: Record<string, unknown>,
  signerId: string,
  publicKey: string,
): boolean {
  const signatures = value.signatures as Record<string, unknown> | undefined;
  const parsed = SignatureSchema.safeParse(signatures?.[signerId]);
  if (!parsed.success) return false;
  const key = {
    key: Buffer.from(publicKey, 'base64url'),
    type: 'spki' as const,
    format: 'der' as const,
  };
  return verify(
    null,
    Buffer.from(canonicalize(unsigned(value))),
    key,
    Buffer.from(parsed.data.value, 'base64url'),
  );
}
