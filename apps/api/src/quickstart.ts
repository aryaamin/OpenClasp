import { randomUUID } from 'node:crypto';
import {
  FederatedInteractionSchema,
  InteractionCompletionReportSchema,
  InteractionFeedbackSchema,
  canonicalHash,
  type FeedbackRequest,
  type FederatedInteraction,
  type InteractionCompletionReport,
  type InteractionFeedback,
  type PublicAgentCard,
} from '../../../packages/protocol/src/index.js';
import type { AgentProfile } from '../../../packages/persistence/src/onboarding.js';

export type QuickstartAgreementInput = {
  task: string;
  requestedOutcome: string;
  successCriterion: string;
  taskCategory?: string | undefined;
  deadline?: string | undefined;
};

export function buildQuickstartInteraction(
  initiator: PublicAgentCard,
  responder: PublicAgentCard,
  input: QuickstartAgreementInput,
  options: { interactionId?: string; now?: Date } = {},
): FederatedInteraction {
  if (initiator.agentId === responder.agentId)
    throw new Error('Choose a different agent as the counterparty');
  if (initiator.agentMode === 'temporary_chat' && responder.agentMode === 'temporary_chat')
    throw new Error('A hosted temporary agent needs a connected persistent counterparty');
  const responderTransport = responder.transports[0];
  if (!responderTransport) throw new Error('The counterparty does not have a usable A2A runtime');
  const now = options.now ?? new Date();
  const interactionId = options.interactionId ?? randomUUID();
  const task = input.task.trim();
  const requestedOutcome = input.requestedOutcome.trim();
  const successCriterion = input.successCriterion.trim();
  const taskCategory = input.taskCategory?.trim() || responder.capabilities[0] || 'general';
  const contract = {
    protocolVersion: '0.1' as const,
    interactionId,
    purpose: task.slice(0, 500),
    parties: [initiator.agentId, responder.agentId],
    taskCategory,
    requestedOutcome,
    successCriteria: [successCriterion],
    allowedActions: ['Communicate about the agreed task', 'Produce the requested outcome'],
    prohibitedActions: ['Act outside the agreed task without renewed approval'],
    allowedData: ['Information explicitly shared for this interaction'],
    prohibitedData: ['credentials', 'government identifiers', 'payment card data'],
    ...(input.deadline ? { deadline: input.deadline } : {}),
    evidenceRequirements: ['Reference inspectable evidence for material factual claims'],
    delegationRules: ['explicit_contract_scope'],
    humanApprovalRequirements: [],
    factCheckingPolicy: 'important_claims',
    mediationPolicy: 'mutual_consent' as const,
    retentionDays: 30,
    completionConditions: [successCriterion],
    cancellationConditions: ['either_party_before_completion'],
    signatures: {},
  };
  const termsHash = canonicalHash(contract);
  const createdAt = now.toISOString();
  return FederatedInteractionSchema.parse({
    protocolVersion: '0.1',
    interactionId,
    initiatorAgentId: initiator.agentId,
    responderAgentId: responder.agentId,
    status: 'pending',
    contract,
    termsHash,
    acceptances: {
      [initiator.agentId]: {
        agentId: initiator.agentId,
        method: 'oauth_account',
        termsHash,
        acceptedAt: createdAt,
      },
    },
    contractRevision: 1,
    contractRevisions: [],
    ...(initiator.transports[0] ? { initiatorTransport: initiator.transports[0] } : {}),
    responderTransport,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(now.getTime() + 72 * 60 * 60_000).toISOString(),
  });
}

export function buildOwnerCompletionReport(
  interaction: FederatedInteraction,
  agent: AgentProfile,
  input: {
    outcome: InteractionCompletionReport['outcome'];
    summary: string;
    evidenceReferences?: string[] | undefined;
  },
  options: { reportId?: string; now?: Date; startedAt?: string } = {},
): InteractionCompletionReport {
  const counterpartyAgentId =
    interaction.initiatorAgentId === agent.agentId
      ? interaction.responderAgentId
      : interaction.initiatorAgentId;
  if (!interaction.contract.parties.includes(agent.agentId))
    throw new Error('The selected agent is not part of this interaction');
  const status =
    input.outcome === 'success'
      ? 'met'
      : input.outcome === 'partial'
        ? 'partially_met'
        : input.outcome === 'failure'
          ? 'missed'
          : 'unknown';
  const completedAt = (options.now ?? new Date()).toISOString();
  return InteractionCompletionReportSchema.parse({
    reportId: options.reportId ?? randomUUID(),
    interactionId: interaction.interactionId,
    contractHash: interaction.termsHash,
    reportingAgentId: agent.agentId,
    counterpartyAgentId,
    agentVersion: agent.agentVersion,
    outcome: input.outcome,
    summary: input.summary.trim(),
    requestedOutcome: interaction.contract.requestedOutcome,
    criteria: interaction.contract.successCriteria.map((criterion) => ({
      criterion,
      status,
      explanation: input.summary.trim(),
      evidenceReferences: input.evidenceReferences ?? [],
    })),
    deliverables: [],
    actionsTaken: [],
    blockers: input.outcome === 'failure' ? [input.summary.trim()] : [],
    scopeChanges: [],
    corrections: [],
    evidenceReferences: input.evidenceReferences ?? [],
    ...(options.startedAt ? { startedAt: options.startedAt } : {}),
    completedAt,
    confidence: 0.8,
    dataSharingMode: 'structured_only',
    submissionMethod: 'oauth_account',
  });
}

export function buildOwnerFeedback(
  request: FeedbackRequest,
  agent: AgentProfile,
  input: {
    rating: number;
    wouldWorkAgain: InteractionFeedback['wouldWorkAgain'];
    privateComment?: string | undefined;
  },
  options: { feedbackId?: string; now?: Date } = {},
): InteractionFeedback {
  if (request.reviewerAgentId !== agent.agentId)
    throw new Error('The selected agent cannot answer this feedback request');
  const normalizedRating = (input.rating - 1) / 4;
  return InteractionFeedbackSchema.parse({
    feedbackId: options.feedbackId ?? randomUUID(),
    requestId: request.requestId,
    interactionId: request.interactionId,
    reviewerAgentId: request.reviewerAgentId,
    subjectAgentId: request.subjectAgentId,
    reviewerAgentVersion: agent.agentVersion,
    ratings: Object.fromEntries(
      request.requestedDimensions.map((dimension) => [dimension, normalizedRating]),
    ),
    wouldWorkAgain: input.wouldWorkAgain,
    reasonCodes: input.wouldWorkAgain === 'no' ? ['would_not_work_again'] : [],
    ...(input.privateComment?.trim() ? { privateComment: input.privateComment.trim() } : {}),
    evidenceReferences: [],
    confidence: 0.8,
    submittedAt: (options.now ?? new Date()).toISOString(),
    submissionMethod: 'oauth_account',
  });
}
