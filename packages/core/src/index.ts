import { randomUUID } from 'node:crypto';
import {
  AgentIdentitySchema,
  CounterpartyBriefSchema,
  canonicalHash,
  createKeyPair,
  DelegationCredentialSchema,
  FeedbackSchema,
  FeedbackDimensionSchema,
  InteractionContractSchema,
  InteractionConclusionSchema,
  InteractionEventSchema,
  LearningEligibilityDecisionSchema,
  ReceiptSchema,
  signNamed,
  signObject,
  TrustEnvelopeSchema,
  verifyNamed,
  verifyObject,
  type AgentIdentity,
  type CounterpartyBrief,
  type DelegationCredential,
  type FactCheckResult,
  type Feedback,
  type InteractionContract,
  type InteractionConclusion,
  type InteractionCompletionReport,
  type InteractionFeedback,
  type InteractionEvent,
  type KeyPair,
  type LiveSessionInsight,
  type LearningEligibilityDecision,
  type PublicAgentCard,
  type Receipt,
  type RiskDecision,
  type TrustEnvelope,
} from '../../protocol/src/index.js';

const REQUIREMENT_STOP_WORDS = new Set([
  'about',
  'agent',
  'available',
  'from',
  'have',
  'into',
  'must',
  'provide',
  'return',
  'should',
  'that',
  'their',
  'this',
  'with',
]);

function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function meaningfulTerms(value: string): string[] {
  return [
    ...new Set(
      normalized(value)
        .split(' ')
        .filter((term) => term.length >= 4 && !REQUIREMENT_STOP_WORDS.has(term)),
    ),
  ];
}

function assessDeclaration(
  requirement: string,
  declarations: string[],
): { status: 'match' | 'partial' | 'mismatch' | 'unknown'; reason: string; confidence: number } {
  const normalizedRequirement = normalized(requirement);
  const normalizedDeclarations = declarations.map(normalized);
  if (
    normalizedDeclarations.some(
      (declaration) => declaration === '*' || declaration === normalizedRequirement,
    )
  )
    return {
      status: 'match',
      reason: 'The counterparty explicitly declares this capability.',
      confidence: 0.95,
    };

  const terms = meaningfulTerms(requirement);
  const negative = normalizedDeclarations.find((declaration) =>
    terms.some(
      (term) =>
        declaration.includes(`no ${term}`) ||
        declaration.includes(`not ${term}`) ||
        declaration.includes(`cannot ${term}`),
    ),
  );
  if (negative)
    return {
      status: 'mismatch',
      reason: `The counterparty declares a conflicting limitation: ${negative}`,
      confidence: 0.95,
    };

  if (terms.length) {
    const declarationText = normalizedDeclarations.join(' ');
    const overlap = terms.filter((term) => declarationText.includes(term)).length / terms.length;
    if (overlap >= 0.6)
      return {
        status: 'match',
        reason: 'The counterparty declarations strongly match this requirement.',
        confidence: 0.8,
      };
    if (overlap > 0)
      return {
        status: 'partial',
        reason: 'The counterparty declarations only partially cover this requirement.',
        confidence: 0.65,
      };
  }
  return {
    status: 'unknown',
    reason: 'The published agent card does not establish this requirement.',
    confidence: 0.35,
  };
}

export function buildCounterpartyBrief(input: {
  interactionId: string;
  contractHash: string;
  contract: InteractionContract;
  recipientAgentId: string;
  subject: PublicAgentCard;
  historyInsights: LiveSessionInsight[];
  relevantSampleSize: number;
  historyConfidence: number;
  generatedAt?: string;
  expiresAt: string;
}): CounterpartyBrief {
  const declarations = [
    input.subject.description,
    ...input.subject.capabilities,
    ...input.subject.limitations,
  ];
  const requirements = [
    {
      requirementId: 'task-category',
      requirement: input.contract.taskCategory,
      kind: 'capability' as const,
    },
    {
      requirementId: 'requested-outcome',
      requirement: input.contract.requestedOutcome,
      kind: 'scope' as const,
    },
    ...input.contract.allowedActions.map((requirement, index) => ({
      requirementId: `allowed-action-${index + 1}`,
      requirement,
      kind: 'capability' as const,
    })),
    ...input.contract.successCriteria.map((requirement, index) => ({
      requirementId: `success-criterion-${index + 1}`,
      requirement,
      kind: 'success_criterion' as const,
    })),
    ...input.contract.evidenceRequirements.map((requirement, index) => ({
      requirementId: `evidence-${index + 1}`,
      requirement,
      kind: 'evidence' as const,
    })),
  ].map((requirement) => ({
    ...requirement,
    ...assessDeclaration(requirement.requirement, declarations),
    sources: ['contract', 'self_declared'] as const,
    evidenceReferences: [input.subject.cardUrl],
  }));
  const requirementReferences = requirements
    .filter((requirement) => requirement.status !== 'match')
    .map((requirement) => requirement.requirementId);
  const insights = input.historyInsights.map((insight) => ({
    ...insight,
    requirementReferences:
      insight.requirementReferences.length > 0
        ? insight.requirementReferences
        : requirementReferences,
  }));
  const needsChallenge =
    input.relevantSampleSize === 0 ||
    requirements.some((requirement) => requirement.status === 'mismatch') ||
    insights.some((insight) => insight.severity === 'high');
  return CounterpartyBriefSchema.parse({
    briefId: randomUUID(),
    interactionId: input.interactionId,
    contractHash: input.contractHash,
    recipientAgentId: input.recipientAgentId,
    subjectAgentId: input.subject.agentId,
    taskCategory: input.contract.taskCategory,
    decision: needsChallenge ? 'CHALLENGE' : 'ALLOW',
    requirements,
    insights,
    relevantSampleSize: input.relevantSampleSize,
    historyConfidence: input.historyConfidence,
    subjectAgentVersion: input.subject.agentVersion,
    recommendedContractChanges: requirements
      .filter((requirement) => requirement.status === 'mismatch')
      .map((requirement) => `Resolve mismatch: ${requirement.requirement}`),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt,
  });
}

export function buildInteractionConclusion(input: {
  interaction: { interactionId: string; termsHash: string; contract: InteractionContract };
  reports: InteractionCompletionReport[];
  feedback: InteractionFeedback[];
  conclusionId?: string;
  generatedAt?: string;
  lifecycle?: 'provisional' | 'final';
  pendingFeedbackAgentIds?: string[];
  peerReportStatus?: InteractionConclusion['peerReportStatus'];
}): InteractionConclusion {
  const outcomes = input.reports.map((report) => report.outcome);
  const uniqueOutcomes = new Set(outcomes);
  const outcome =
    outcomes.length === 0
      ? ('cancelled' as const)
      : uniqueOutcomes.size === 1
        ? outcomes[0]!
        : outcomes.includes('failure')
          ? ('failure' as const)
          : ('partial' as const);
  const consensus =
    input.reports.length < 2
      ? ('unilateral' as const)
      : uniqueOutcomes.size === 1
        ? ('bilateral_agreement' as const)
        : outcomes.includes('partial')
          ? ('bilateral_partial_agreement' as const)
          : ('conflicting' as const);
  const statusRank = { met: 0, partially_met: 1, unknown: 2, missed: 3 } as const;
  const criteria = input.interaction.contract.successCriteria.map((criterion) => {
    const assessments = input.reports
      .flatMap((report) => report.criteria)
      .filter((assessment) => assessment.criterion === criterion);
    const selected = assessments.sort(
      (left, right) => statusRank[right.status] - statusRank[left.status],
    )[0];
    return {
      criterion,
      status: selected?.status ?? ('unknown' as const),
      ...(selected?.explanation ? { explanation: selected.explanation } : {}),
      evidenceReferences: [
        ...new Set(assessments.flatMap((assessment) => assessment.evidenceReferences)),
      ],
    };
  });
  const averageRatings = Object.fromEntries(
    FeedbackDimensionSchema.options.flatMap((dimension) => {
      const values = input.feedback
        .map((item) => item.ratings[dimension])
        .filter((value): value is number => typeof value === 'number');
      return values.length
        ? [[dimension, values.reduce((total, value) => total + value, 0) / values.length]]
        : [];
    }),
  );
  const reportedAgentIds = new Set(input.reports.map((report) => report.reportingAgentId));
  const missingReportAgentIds = input.interaction.contract.parties.filter(
    (agentId) => !reportedAgentIds.has(agentId),
  );
  const lifecycle = input.lifecycle ?? (missingReportAgentIds.length ? 'provisional' : 'final');
  const reportConfidence = input.reports.length
    ? input.reports.reduce((total, report) => total + report.confidence, 0) / input.reports.length
    : 0;
  const confidence =
    input.reports.length >= 2
      ? Math.min(0.95, reportConfidence * 0.9 + (uniqueOutcomes.size === 1 ? 0.05 : 0))
      : Math.min(0.55, reportConfidence * 0.6);
  const reportSummary = input.reports[0]?.summary;
  const summary =
    lifecycle === 'provisional'
      ? `Provisional one-sided outcome: ${reportSummary ?? 'one participant supplied a terminal report'}. The peer has not supplied an independent completion report.`
      : input.reports.length >= 2
        ? `${input.reports.length} independent completion reports were reconciled${input.feedback.length ? ` with ${input.feedback.length} eligible feedback response${input.feedback.length === 1 ? '' : 's'}` : ''}.`
        : `Final unilateral outcome: ${reportSummary ?? 'one participant supplied the available terminal report'}. The peer response window closed without an independent completion report.`;
  return InteractionConclusionSchema.parse({
    conclusionId: input.conclusionId ?? randomUUID(),
    interactionId: input.interaction.interactionId,
    contractHash: input.interaction.termsHash,
    outcome,
    consensus,
    lifecycle,
    confidence,
    missingReportAgentIds,
    pendingFeedbackAgentIds: input.pendingFeedbackAgentIds ?? [],
    peerReportStatus:
      input.reports.length >= 2 ? 'received' : (input.peerReportStatus ?? 'awaiting'),
    summary: summary.slice(0, 2000),
    criteria,
    reportIds: input.reports.map((report) => report.reportId),
    feedbackIds: input.feedback.map((item) => item.feedbackId),
    averageRatings,
    evidenceReferences: [...new Set(input.reports.flatMap((report) => report.evidenceReferences))],
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });
}

function extremeFeedbackPenalty(feedback: InteractionFeedback): number {
  const ratings = Object.values(feedback.ratings).filter(
    (value): value is number => typeof value === 'number',
  );
  if (!ratings.length) return 0.5;
  const extremeShare =
    ratings.filter((value) => value === 0 || value === 1).length / ratings.length;
  return extremeShare === 1 && feedback.evidenceReferences.length === 0 ? 0.6 : 1;
}

export function evaluateLearningEligibility(input: {
  interactionId: string;
  reports: InteractionCompletionReport[];
  feedback: InteractionFeedback[];
  consensus: InteractionConclusion['consensus'];
  contributionMode: 'local_only' | 'network_aggregate';
  reviewerCredibility?: Record<string, number>;
  decisionId?: string;
  decidedAt?: string;
}): LearningEligibilityDecision {
  const attestedReports = input.reports.filter((report) => report.platformAttestation);
  const attestedFeedback = input.feedback.filter((item) => item.platformAttestation);
  const bilateralReports =
    new Set(attestedReports.map((report) => report.reportingAgentId)).size >= 2;
  const evidenceReferences = [
    ...new Set([
      ...attestedReports.flatMap((report) => report.evidenceReferences),
      ...attestedFeedback.flatMap((item) => item.evidenceReferences),
    ]),
  ];
  const evidenceBacked = bilateralReports || evidenceReferences.length > 0;
  const eligible = attestedReports.length > 0;
  const contributionMode =
    input.contributionMode === 'network_aggregate' && !bilateralReports
      ? ('local_only' as const)
      : input.contributionMode;
  const reviewerWeight = attestedFeedback.length
    ? attestedFeedback.reduce((total, item) => {
        const credibility = Math.max(
          0.1,
          Math.min(1, input.reviewerCredibility?.[item.reviewerAgentId] ?? 0.5),
        );
        return total + item.confidence * credibility * extremeFeedbackPenalty(item);
      }, 0) / attestedFeedback.length
    : 0;
  const sampleWeight = eligible
    ? Math.max(
        0.1,
        Math.min(
          1,
          0.1 +
            (bilateralReports ? 0.35 : 0) +
            Math.min(0.2, reviewerWeight * 0.2) +
            (evidenceReferences.length ? 0.1 : 0) -
            (input.consensus === 'conflicting' ? 0.2 : 0),
        ),
      )
    : 0;
  const reasons = [
    attestedReports.length
      ? `${attestedReports.length} platform-attested completion report(s)`
      : 'No attested completion report',
    bilateralReports
      ? 'Bilateral reports provide outcome corroboration'
      : 'Outcome is not bilaterally corroborated',
    attestedFeedback.length
      ? `${attestedFeedback.length} eligible feedback response(s)`
      : 'No eligible feedback response',
    evidenceReferences.length
      ? `${evidenceReferences.length} permitted evidence reference(s)`
      : 'No permitted external evidence reference',
    !bilateralReports && eligible
      ? 'One-sided structured evidence is retained locally at reduced weight'
      : evidenceBacked
        ? 'Evidence threshold supports the configured contribution mode'
        : 'Evidence is insufficient for shared-network contribution',
    input.consensus === 'conflicting'
      ? 'Conflicting reports reduce sample weight'
      : 'No report-conflict penalty',
  ];
  return LearningEligibilityDecisionSchema.parse({
    decisionId: input.decisionId ?? randomUUID(),
    interactionId: input.interactionId,
    eligible,
    reasons,
    sampleWeight,
    reportIds: attestedReports.map((report) => report.reportId),
    feedbackIds: attestedFeedback.map((item) => item.feedbackId),
    evidenceReferences,
    contributionMode,
    structuredDataOnly: true,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  });
}

export type BehaviouralObservations = Partial<
  Record<
    | 'completion'
    | 'acceptance'
    | 'specification'
    | 'deadline'
    | 'communication'
    | 'evidence'
    | 'scope'
    | 'disputes',
    number
  >
>;

export const BEHAVIOURAL_DIMENSIONS = [
  'completion',
  'acceptance',
  'specification',
  'deadline',
  'communication',
  'evidence',
  'scope',
  'disputes',
] as const;

export type BehaviouralDimension = (typeof BEHAVIOURAL_DIMENSIONS)[number];

export type ContextualBehaviouralProfile = Record<BehaviouralDimension, number> & {
  sampleSize: number;
  effectiveSampleSize: number;
  updatedAt: string;
};

export function updateContextualBehaviouralProfile(input: {
  current?: Partial<ContextualBehaviouralProfile>;
  observations: BehaviouralObservations;
  sampleWeight: number;
  appliedAt?: string;
  decayDays?: number;
}): { profile: ContextualBehaviouralProfile; dimensionDeltas: Record<string, number> } {
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  const decayDays = input.decayDays ?? 180;
  const priorAgeDays = input.current?.updatedAt
    ? Math.max(0, (Date.parse(appliedAt) - Date.parse(input.current.updatedAt)) / 86_400_000)
    : 0;
  const priorEffectiveSampleSize = Math.max(
    0,
    input.current?.effectiveSampleSize ?? input.current?.sampleSize ?? 0,
  );
  const decayedPriorWeight =
    priorEffectiveSampleSize * Math.exp(-priorAgeDays / Math.max(1, decayDays));
  const sampleWeight = Math.max(0, Math.min(1, input.sampleWeight));
  const hasObservation = BEHAVIOURAL_DIMENSIONS.some(
    (dimension) => typeof input.observations[dimension] === 'number',
  );
  const nextEffectiveSampleSize = decayedPriorWeight + (hasObservation ? sampleWeight : 0);
  const dimensionDeltas: Record<string, number> = {};
  const dimensions = Object.fromEntries(
    BEHAVIOURAL_DIMENSIONS.map((dimension) => {
      const previous = Math.max(0, Math.min(1, input.current?.[dimension] ?? 0.5));
      const observed = input.observations[dimension];
      if (typeof observed !== 'number' || sampleWeight === 0) return [dimension, previous];
      const next =
        (previous * decayedPriorWeight + Math.max(0, Math.min(1, observed)) * sampleWeight) /
        Math.max(Number.EPSILON, nextEffectiveSampleSize);
      dimensionDeltas[dimension] = next - previous;
      return [dimension, next];
    }),
  ) as Record<BehaviouralDimension, number>;
  return {
    profile: {
      ...dimensions,
      sampleSize:
        Math.max(0, Math.floor(input.current?.sampleSize ?? 0)) +
        (hasObservation && sampleWeight > 0 ? 1 : 0),
      effectiveSampleSize: nextEffectiveSampleSize,
      updatedAt: appliedAt,
    },
    dimensionDeltas,
  };
}

export function deriveBehaviouralObservations(input: {
  subjectAgentId: string;
  reviewerAgentId?: string;
  reports: InteractionCompletionReport[];
  reviewerFeedback?: InteractionFeedback;
  conclusion: InteractionConclusion;
}): BehaviouralObservations {
  const subjectReport = input.reviewerAgentId
    ? input.reports.find(
        (report) =>
          report.reportingAgentId === input.reviewerAgentId &&
          report.counterpartyAgentId === input.subjectAgentId,
      )
    : (input.reports.find((report) => report.counterpartyAgentId === input.subjectAgentId) ??
      input.reports.find((report) => report.reportingAgentId === input.subjectAgentId));
  const criteria =
    subjectReport?.criteria.filter((criterion) => criterion.status !== 'unknown') ?? [];
  const criterionValue = (status: (typeof criteria)[number]['status']) =>
    status === 'met' ? 1 : status === 'partially_met' ? 0.5 : 0;
  const ratings = input.reviewerFeedback?.ratings;
  const observation: BehaviouralObservations = {
    ...(subjectReport
      ? {
          completion:
            subjectReport.outcome === 'success' ? 1 : subjectReport.outcome === 'partial' ? 0.5 : 0,
        }
      : {}),
    ...(criteria.length
      ? {
          specification:
            criteria.reduce((total, criterion) => total + criterionValue(criterion.status), 0) /
            criteria.length,
        }
      : {}),
    ...(typeof ratings?.outcome_satisfaction === 'number'
      ? { acceptance: ratings.outcome_satisfaction }
      : {}),
    ...(typeof ratings?.timeliness === 'number' ? { deadline: ratings.timeliness } : {}),
    ...(typeof ratings?.communication === 'number' ? { communication: ratings.communication } : {}),
    ...(typeof ratings?.evidence_quality === 'number'
      ? { evidence: ratings.evidence_quality }
      : {}),
    ...(typeof ratings?.scope_adherence === 'number' ? { scope: ratings.scope_adherence } : {}),
    ...(subjectReport || input.reviewerFeedback
      ? { disputes: input.conclusion.consensus === 'conflicting' ? 1 : 0 }
      : {}),
  };
  return Object.fromEntries(
    Object.entries(observation).map(([key, value]) => [key, Math.max(0, Math.min(1, value))]),
  );
}

export interface AuditStore {
  append(kind: string, id: string, value: unknown): void;
  list(kind: string): unknown[];
}

export class MemoryAuditStore implements AuditStore {
  private rows: { kind: string; id: string; value: unknown }[] = [];
  append(kind: string, id: string, value: unknown): void {
    const old = this.rows.find((row) => row.kind === kind && row.id === id);
    if (old && canonicalHash(old.value) !== canonicalHash(value))
      throw new Error(`Conflicting duplicate ${kind}:${id}`);
    if (!old) this.rows.push({ kind, id, value: structuredClone(value) });
  }
  list(kind: string): unknown[] {
    return this.rows.filter((row) => row.kind === kind).map((row) => structuredClone(row.value));
  }
}

export function createIdentity(input: {
  agentId: string;
  operatorRef: string;
  version?: string;
  capabilities: string[];
  assurance?: AgentIdentity['assurance'];
  parentAgentId?: string;
  rootControllerId?: string;
}): { identity: AgentIdentity; keyPair: KeyPair } {
  const keyPair = createKeyPair(`${input.agentId}#1`);
  const identity: Record<string, unknown> = {
    protocolVersion: '0.1',
    agentId: input.agentId,
    publicKey: keyPair.publicKey,
    keyId: keyPair.keyId,
    operatorRef: input.operatorRef,
    assurance: input.assurance ?? 'pseudonymous',
    agentVersion: input.version ?? '1.0.0',
    capabilities: input.capabilities,
    supportedProtocols: ['A2A/1.0', 'OpenClasp/0.1'],
    ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
    rootControllerId: input.rootControllerId ?? input.agentId,
    revoked: false,
    provenance: 'cryptographically_verified',
    createdAt: new Date().toISOString(),
  };
  return { identity: AgentIdentitySchema.parse(signObject(identity, keyPair)), keyPair };
}

export type PolicyContext = {
  envelope: TrustEnvelope;
  action: string;
  dataClasses?: string[];
  humanApproved?: boolean;
};

export type Conflict = {
  conflictId: string;
  interactionId: string;
  issue: string;
  positions: Record<string, string>;
  evidence: string[];
  contractClauses: string[];
  missingInformation: string[];
  possibleResolutions: string[];
  permissions: Record<string, boolean>;
  status: 'pending_consent' | 'open' | 'resolved';
  resolution?: string;
};

type ProfileAggregate = {
  agentId: string;
  agentVersion: string;
  taskCategory: string;
  sampleSize: number;
  updatedAt: string;
  completion: number;
  acceptance: number;
  specification: number;
  deadline: number;
  communication: number;
  evidence: number;
  scope: number;
  disputes: number;
};

export class TrustEngine {
  readonly agents = new Map<string, AgentIdentity>();
  readonly delegations = new Map<string, DelegationCredential>();
  readonly contracts = new Map<string, InteractionContract>();
  readonly events = new Map<string, InteractionEvent>();
  readonly receipts = new Map<string, Receipt>();
  readonly conflicts = new Map<string, Conflict>();
  readonly feedback = new Map<string, Feedback>();
  readonly profiles = new Map<string, ProfileAggregate>();
  readonly contributionConsent = new Map<
    string,
    { enabled: boolean; grantedAt: string; revokedAt?: string }
  >();
  private readonly nonces = new Set<string>();

  constructor(readonly store: AuditStore = new MemoryAuditStore()) {
    for (const value of store.list('agent') as AgentIdentity[])
      this.agents.set(value.agentId, value);
    for (const value of store.list('delegation') as DelegationCredential[])
      this.delegations.set(value.delegationId, value);
    for (const value of store.list('contract') as InteractionContract[])
      this.contracts.set(value.interactionId, value);
    for (const value of store.list('event') as InteractionEvent[])
      this.events.set(value.eventId, value);
    for (const value of store.list('receipt') as Receipt[])
      this.receipts.set(value.receiptId, value);
    for (const value of store.list('feedback') as Feedback[])
      this.feedback.set(value.feedbackId, value);
    for (const value of store.list('profile') as ProfileAggregate[])
      this.profiles.set(`${value.agentId}|${value.agentVersion}|${value.taskCategory}`, value);
    for (const value of store.list('conflict') as Conflict[])
      this.conflicts.set(value.conflictId, value);
    for (const value of store.list('consent') as {
      agentId: string;
      enabled: boolean;
      grantedAt: string;
      revokedAt?: string;
    }[])
      this.contributionConsent.set(value.agentId, value);
    for (const value of store.list('revocation') as {
      agentId?: string;
      delegationId?: string;
    }[]) {
      if (value.agentId && this.agents.has(value.agentId))
        this.agents.set(value.agentId, { ...this.agents.get(value.agentId)!, revoked: true });
      if (value.delegationId && this.delegations.has(value.delegationId))
        this.delegations.set(value.delegationId, {
          ...this.delegations.get(value.delegationId)!,
          revoked: true,
        });
    }
  }

  registerAgent(identity: AgentIdentity): AgentIdentity {
    const parsed = AgentIdentitySchema.parse(identity);
    if (!verifyObject(parsed as unknown as Record<string, unknown>, parsed.publicKey))
      throw new Error('Invalid identity signature');
    if (parsed.parentAgentId && parsed.rootControllerId === parsed.agentId)
      throw new Error('Child cannot remove root-controller reference');
    this.agents.set(parsed.agentId, parsed);
    this.store.append('agent', parsed.agentId, parsed);
    return parsed;
  }

  revokeAgent(agentId: string): void {
    const identity = this.requireAgent(agentId);
    const revoked = { ...identity, revoked: true };
    this.agents.set(agentId, revoked);
    this.store.append('revocation', `agent:${agentId}`, { agentId, at: new Date().toISOString() });
  }

  createDelegation(
    parentId: string,
    childId: string,
    capabilities: string[],
    expiresAt: string,
    parentKey: KeyPair,
  ): DelegationCredential {
    const parent = this.requireAgent(parentId);
    const child = this.requireAgent(childId);
    if (parent.revoked) throw new Error('Parent agent is revoked');
    if (child.parentAgentId !== parentId || child.rootControllerId !== parent.rootControllerId)
      throw new Error('Invalid child lineage');
    if (capabilities.some((capability) => !parent.capabilities.includes(capability)))
      throw new Error('Delegation exceeds parent authority');
    const raw = {
      protocolVersion: '0.1' as const,
      delegationId: randomUUID(),
      parentAgentId: parentId,
      childAgentId: childId,
      rootControllerId: parent.rootControllerId,
      capabilities,
      issuedAt: new Date().toISOString(),
      expiresAt,
      revoked: false,
    };
    const credential = DelegationCredentialSchema.parse(signObject(raw, parentKey));
    this.delegations.set(credential.delegationId, credential);
    this.store.append('delegation', credential.delegationId, credential);
    return credential;
  }

  verifyDelegation(delegationId: string, capability?: string, at = new Date()): boolean {
    const delegation = this.delegations.get(delegationId);
    if (!delegation || delegation.revoked || new Date(delegation.expiresAt) <= at) return false;
    const parent = this.agents.get(delegation.parentAgentId);
    const child = this.agents.get(delegation.childAgentId);
    if (!parent || !child || parent.revoked || child.revoked) return false;
    if (
      child.rootControllerId !== delegation.rootControllerId ||
      child.parentAgentId !== parent.agentId
    )
      return false;
    if (capability && !delegation.capabilities.includes(capability)) return false;
    if (delegation.capabilities.some((item) => !parent.capabilities.includes(item))) return false;
    return verifyObject(delegation as unknown as Record<string, unknown>, parent.publicKey);
  }

  revokeDelegation(delegationId: string): void {
    const item = this.delegations.get(delegationId);
    if (!item) throw new Error('Delegation not found');
    this.delegations.set(delegationId, { ...item, revoked: true });
    this.store.append('revocation', `delegation:${delegationId}`, {
      delegationId,
      at: new Date().toISOString(),
    });
  }

  saveContract(contract: InteractionContract): InteractionContract {
    const parsed = InteractionContractSchema.parse(contract);
    if (parsed.parties.some((party) => !(party in parsed.signatures)))
      throw new Error('Contract requires every party signature');
    for (const party of Object.keys(parsed.signatures)) {
      const agent = this.requireAgent(party);
      if (!verifyNamed(parsed as unknown as Record<string, unknown>, party, agent.publicKey))
        throw new Error(`Invalid contract signature: ${party}`);
    }
    this.contracts.set(parsed.interactionId, parsed);
    this.store.append('contract', parsed.interactionId, parsed);
    return parsed;
  }

  assess(context: PolicyContext): RiskDecision {
    const envelope = TrustEnvelopeSchema.parse(context.envelope);
    const responder = this.agents.get(envelope.respondingAgentId);
    const requester = this.agents.get(envelope.requestingAgentId);
    const contract = this.contracts.get(envelope.interactionId);
    const hardFailures: string[] = [];
    if (
      !requester ||
      requester.revoked ||
      !verifyObject(envelope as unknown as Record<string, unknown>, requester.publicKey)
    )
      hardFailures.push('invalid_requester_signature');
    if (!responder || responder.revoked) hardFailures.push('invalid_or_revoked_responder');
    if (new Date(envelope.expiresAt) <= new Date()) hardFailures.push('expired_envelope');
    if (this.nonces.has(envelope.nonce)) hardFailures.push('replay_attempt');
    if (
      envelope.delegationId &&
      !this.verifyDelegation(envelope.delegationId, envelope.requestedCapability)
    )
      hardFailures.push('invalid_delegation');
    if (!contract || canonicalHash({ ...contract, signatures: {} }) !== envelope.contractHash)
      hardFailures.push('contract_mismatch');
    if (
      contract &&
      (!contract.allowedActions.includes(context.action) ||
        contract.prohibitedActions.includes(context.action))
    )
      hardFailures.push('action_outside_contract');
    if (
      contract &&
      (context.dataClasses ?? []).some((item) => contract.prohibitedData.includes(item))
    )
      hardFailures.push('prohibited_data');
    if (
      contract &&
      contract.humanApprovalRequirements.includes(context.action) &&
      !context.humanApproved
    )
      hardFailures.push('missing_human_approval');
    if (!hardFailures.includes('replay_attempt')) this.nonces.add(envelope.nonce);
    if (hardFailures.length)
      return this.decision('DENY', envelope.taskCategory, 1, hardFailures, [], []);

    const risk = this.getRisk(
      envelope.respondingAgentId,
      responder?.agentVersion ?? envelope.agentVersion,
      envelope.taskCategory,
    );
    return risk;
  }

  recordEvent(event: InteractionEvent): InteractionEvent {
    const parsed = InteractionEventSchema.parse(event);
    const agent = this.requireAgent(parsed.agentId);
    if (!verifyObject(parsed as unknown as Record<string, unknown>, agent.publicKey))
      throw new Error('Invalid event signature');
    if (canonicalHash(parsed.payload) !== parsed.payloadHash)
      throw new Error('Event payload hash mismatch');
    const existing = this.events.get(parsed.eventId);
    if (existing && canonicalHash(existing) !== canonicalHash(parsed))
      throw new Error('Conflicting duplicate event');
    this.events.set(parsed.eventId, parsed);
    this.store.append('event', parsed.eventId, parsed);
    return parsed;
  }

  createConflict(
    input: Omit<Conflict, 'conflictId' | 'status' | 'permissions'> & { participants: string[] },
  ): Conflict {
    const permissions = Object.fromEntries(input.participants.map((id) => [id, false]));
    const conflict: Conflict = {
      ...input,
      conflictId: randomUUID(),
      permissions,
      status: 'pending_consent',
    };
    delete (conflict as any).participants;
    this.conflicts.set(conflict.conflictId, conflict);
    this.store.append('conflict', `${conflict.conflictId}:created`, conflict);
    return conflict;
  }

  permitMediation(conflictId: string, agentId: string): Conflict {
    const conflict = this.requireConflict(conflictId);
    if (!(agentId in conflict.permissions)) throw new Error('Agent is not a conflict participant');
    conflict.permissions[agentId] = true;
    if (Object.values(conflict.permissions).every(Boolean)) conflict.status = 'open';
    this.store.append('conflict', `${conflict.conflictId}:permit:${agentId}`, conflict);
    return conflict;
  }

  resolveConflict(conflictId: string, resolution: string): Conflict {
    const conflict = this.requireConflict(conflictId);
    if (conflict.status !== 'open') throw new Error('Mutual mediation consent required');
    conflict.status = 'resolved';
    conflict.resolution = resolution;
    this.store.append('conflict', `${conflict.conflictId}:resolved`, conflict);
    return conflict;
  }

  submitReceipt(receipt: Receipt): Receipt {
    const parsed = this.verifyReceipt(receipt);
    this.receipts.set(parsed.receiptId, parsed);
    this.store.append('receipt', parsed.receiptId, parsed);
    return parsed;
  }

  verifyReceipt(receipt: Receipt): Receipt {
    const parsed = ReceiptSchema.parse(receipt);
    const required = parsed.unilateral
      ? Object.keys(parsed.signatures).slice(0, 1)
      : parsed.participants;
    if (
      !required.length ||
      required.some((party) => {
        const agent = this.agents.get(party);
        return (
          !agent ||
          !verifyNamed(parsed as unknown as Record<string, unknown>, party, agent.publicKey)
        );
      })
    )
      throw new Error('Receipt signature verification failed');
    return parsed;
  }

  submitFeedback(item: Feedback): { revealed: boolean } {
    const parsed = FeedbackSchema.parse(item);
    const receipt = this.receipts.get(parsed.receiptId);
    const reviewer = this.agents.get(parsed.reviewerAgentId);
    if (
      !receipt ||
      !reviewer ||
      !receipt.participants.includes(parsed.reviewerAgentId) ||
      !receipt.participants.includes(parsed.subjectAgentId)
    )
      throw new Error('Feedback requires a valid participant receipt');
    if (!verifyObject(parsed as unknown as Record<string, unknown>, reviewer.publicKey))
      throw new Error('Invalid feedback signature');
    this.feedback.set(parsed.feedbackId, parsed);
    this.store.append('feedback', parsed.feedbackId, parsed);
    const related = [...this.feedback.values()].filter(
      (value) => value.receiptId === parsed.receiptId,
    );
    const revealed =
      receipt.unilateral ||
      new Set(related.map((value) => value.reviewerAgentId)).size >= receipt.participants.length;
    if (revealed) for (const feedback of related) this.applyFeedback(feedback, receipt);
    return { revealed };
  }

  getRisk(agentId: string, version: string, taskCategory: string): RiskDecision {
    const current = this.profiles.get(`${agentId}|${version}|${taskCategory}`);
    const otherVersions = [...this.profiles.values()].filter(
      (p) => p.agentId === agentId && p.taskCategory === taskCategory,
    );
    if (!current) {
      const continuity = otherVersions.length
        ? Math.min(
            0.2,
            Math.max(
              ...otherVersions.map((profile) => profile.sampleSize / (profile.sampleSize + 5)),
            ) * 0.25,
          )
        : 0;
      return this.decision(
        'CHALLENGE',
        taskCategory,
        continuity,
        ['limited_verified_history'],
        ['Agent version has limited task-specific evidence'],
        ['request_evidence'],
      );
    }
    const ageDays = Math.max(0, (Date.now() - Date.parse(current.updatedAt)) / 86_400_000);
    const freshness = Math.exp(-ageDays / 180);
    const quality =
      (current.completion +
        current.acceptance +
        current.specification +
        current.deadline +
        current.communication +
        current.evidence +
        current.scope +
        (1 - current.disputes)) /
      8;
    const confidence = Math.min(0.95, (current.sampleSize / (current.sampleSize + 5)) * freshness);
    const decision = quality >= 0.7 && confidence >= 0.25 ? 'ALLOW' : 'CHALLENGE';
    return {
      decision,
      confidence,
      taskCategory,
      sampleSize: current.sampleSize,
      dimensions: {
        completionReliability: current.completion,
        outputAcceptance: current.acceptance,
        contractAdherence: (current.specification + current.scope) / 2,
        deadlineReliability: current.deadline,
        communicationQuality: current.communication,
        evidenceQuality: current.evidence,
        disputeRate: current.disputes,
      },
      reasons: [`contextual_quality=${quality.toFixed(2)}`],
      warnings: confidence < 0.5 ? ['Limited sample size'] : [],
      dataFreshness: { behaviouralProfile: current.updatedAt },
      requiredChallenges: decision === 'CHALLENGE' ? ['request_evidence'] : [],
    };
  }

  setContributionConsent(agentId: string, enabled: boolean): void {
    this.requireAgent(agentId);
    const previous = this.contributionConsent.get(agentId);
    this.contributionConsent.set(
      agentId,
      enabled
        ? { enabled: true, grantedAt: new Date().toISOString() }
        : {
            enabled: false,
            grantedAt: previous?.grantedAt ?? new Date().toISOString(),
            revokedAt: new Date().toISOString(),
          },
    );
    this.store.append('consent', `${agentId}:${Date.now()}`, {
      agentId,
      ...this.contributionConsent.get(agentId),
    });
  }

  networkContribution(event: InteractionEvent): Record<string, unknown> | null {
    if (!this.contributionConsent.get(event.agentId)?.enabled || event.visibility === 'local_only')
      return null;
    return {
      eventId: event.eventId,
      interactionId: event.interactionId,
      eventType: event.eventType,
      agentId: event.agentId,
      agentVersion: event.agentVersion,
      timestamp: event.timestamp,
      visibility: event.visibility,
      provenance: event.provenance,
      payloadHash: event.payloadHash,
      evidenceRefs: event.evidenceRefs ?? [],
      signature: event.signature,
    };
  }

  private applyFeedback(feedback: Feedback, receipt: Receipt): void {
    const taskCategory = this.contracts.get(feedback.interactionId)?.taskCategory ?? 'unknown';
    const version = receipt.agentVersions[feedback.subjectAgentId] ?? 'unknown';
    const key = `${feedback.subjectAgentId}|${version}|${taskCategory}`;
    const previous = this.profiles.get(key);
    const n = previous?.sampleSize ?? 0;
    const next = (old: number | undefined, value: number) => ((old ?? 0) * n + value) / (n + 1);
    const profile = {
      agentId: feedback.subjectAgentId,
      agentVersion: version,
      taskCategory,
      sampleSize: n + 1,
      updatedAt: new Date().toISOString(),
      completion: next(previous?.completion, Number(feedback.taskCompleted)),
      acceptance: next(previous?.acceptance, Number(feedback.outputAccepted)),
      specification: next(previous?.specification, Number(feedback.specificationMatched)),
      deadline: next(previous?.deadline, Number(feedback.deadlineMet)),
      communication: next(previous?.communication, feedback.communicationQuality),
      evidence: next(previous?.evidence, Number(feedback.evidenceProvided)),
      scope: next(previous?.scope, Number(feedback.scopeRespected)),
      disputes: next(previous?.disputes, Number(feedback.disputeRaised)),
    };
    this.profiles.set(key, profile);
    this.store.append('profile', `${key}:${profile.sampleSize}`, profile);
  }

  private decision(
    decision: RiskDecision['decision'],
    taskCategory: string,
    confidence: number,
    reasons: string[],
    warnings: string[],
    challenges: string[],
  ): RiskDecision {
    return {
      decision,
      confidence,
      taskCategory,
      sampleSize: 0,
      dimensions: {},
      reasons,
      warnings,
      dataFreshness: {},
      requiredChallenges: challenges,
    };
  }
  private requireAgent(id: string): AgentIdentity {
    const value = this.agents.get(id);
    if (!value) throw new Error(`Agent not found: ${id}`);
    return value;
  }
  private requireConflict(id: string): Conflict {
    const value = this.conflicts.get(id);
    if (!value) throw new Error('Conflict not found');
    return value;
  }
}

export interface FactCheckProvider {
  check(claim: string, permission?: boolean): Promise<FactCheckResult>;
}

export class FixtureFactCheckProvider implements FactCheckProvider {
  constructor(
    private fixtures: Record<
      string,
      { status: FactCheckResult['status']; evidence: string[] }
    > = {},
  ) {}
  async check(claim: string, permission = true): Promise<FactCheckResult> {
    if (!permission)
      return result(
        claim,
        'objective',
        'insufficient_permission',
        1,
        [],
        'Grant evidence-source permission',
      );
    if (/\b(i think|i prefer|best|beautiful)\b/i.test(claim))
      return result(claim, 'subjective', 'not_fact_checkable', 1, [], 'Treat as an opinion');
    if (/\b(will|might|forecast|predict)\b/i.test(claim))
      return result(
        claim,
        'prediction',
        'not_fact_checkable',
        0.9,
        [],
        'Track as a prediction, not a fact',
      );
    const fixture = this.fixtures[claim];
    if (!fixture)
      return result(claim, 'objective', 'unverified', 0, [], 'Request authoritative evidence');
    return result(
      claim,
      'objective',
      fixture.status,
      0.95,
      fixture.evidence,
      fixture.status === 'contradicted' ? 'Challenge the claim with cited evidence' : 'Continue',
    );
  }
}

function result(
  claim: string,
  claimType: FactCheckResult['claimType'],
  status: FactCheckResult['status'],
  confidence: number,
  evidence: string[],
  action: string,
): FactCheckResult {
  return {
    claim,
    claimType,
    status,
    confidence,
    evidenceReferences: evidence,
    sourceAuthority: evidence.length ? 'authoritative_fixture' : 'none',
    sourceFreshness: new Date().toISOString(),
    contradictingEvidence: status === 'contradicted' ? evidence : [],
    suggestedNextAction: action,
  };
}

export { signNamed, signObject };
