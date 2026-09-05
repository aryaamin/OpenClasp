import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';
import {
  buildCounterpartyBrief,
  buildInteractionConclusion,
  deriveBehaviouralObservations,
  evaluateLearningEligibility,
  summarizeContextualReliability,
  updateContextualBehaviouralProfile,
} from '../../core/src/index.js';
import {
  AgentIdentitySchema,
  AgentResolutionSchema,
  AssuranceDecisionSchema,
  AssuranceEffectivenessEvaluationSchema,
  AssuranceClaimOutcomeComparisonSchema,
  AssurancePredictionSnapshotSchema,
  AssuranceProbePlanSchema,
  AssuranceProbeResponseSchema,
  AssuranceSafeguardSchema,
  BehaviouralProfileDeltaSchema,
  DEFAULT_AGENT_AUTH_SCOPES,
  DEFAULT_EXTENSION_URI,
  CounterpartyBriefSchema,
  ContractRevisionSchema,
  FederatedInteractionSchema,
  FeedbackDimensionSchema,
  FeedbackRequestSchema,
  LiveSessionAcceptanceSchema,
  LiveSessionActivationSchema,
  LiveSessionEventSchema,
  LiveSessionOfferSchema,
  LiveSessionStateRecordSchema,
  InteractionCompletionReportSchema,
  InteractionContractSchema,
  InteractionConclusionSchema,
  InteractionFeedbackSchema,
  LearningEligibilityDecisionSchema,
  PublicAgentCardSchema,
  ReceiptSchema,
  ShieldCaseSchema,
  ShieldConsultationSchema,
  ShieldOutcomeSchema,
  canonicalHash,
  verifyObject,
  type FederatedInteraction,
  type AgentPresence,
  type AgentResolution,
  type AssuranceDecision,
  type AssuranceEffectivenessEvaluation,
  type AssuranceClaimOutcomeComparison,
  type AssurancePredictionSnapshot,
  type AssuranceProbePlan,
  type AssuranceProbeResponse,
  type BehaviouralProfileDelta,
  type CounterpartyBrief,
  type ContractRevision,
  type LiveSessionActivation,
  type LiveSessionEvent,
  type LiveSessionInsight,
  type InteractionCompletionReport,
  type InteractionContract,
  type InteractionFeedback,
  type InteractionConclusion,
  type OpenClaspAuthScope,
  type PublicAgentCard,
  type ShieldCase,
  type ShieldConsultation,
  type ShieldOutcome,
} from '../../protocol/src/index.js';
import type { AgentProfile } from './onboarding.js';
import type { AgentInstallation } from './onboarding.js';
import {
  connectorClaimExpired,
  createConnectorAgent,
  createConnectorClaimInput,
  encryptConnectorCredential,
  matchesConnectorClaimSecret,
  publicConnectorClaim,
  type ConnectorClaim,
} from './connector-claim.js';
import {
  createProviderConnectionInput,
  hashProviderConnectionCode,
  publicProviderConnection,
  type ProviderConnection,
} from './provider-connection.js';
import {
  agentAccessTokenClientId,
  agentAccessTokenId,
  createAgentAccessToken,
  matchesAgentAccessToken,
  type AgentAccessTokenMetadata,
} from './access-token.js';
import {
  decryptGatewayPayload,
  encryptGatewayPayload,
  attestSessionRecord,
  getSessionKeyId,
  getSessionVerificationKey,
  issueSessionGrant,
  signSessionControl,
  verifySessionGrant,
} from './relay.js';
import { postRuntimeJson, resolvePublicRuntimeEndpoint } from './runtime.js';
import { verifyHostedMigrations } from './hosted-migrations.js';
import {
  buildSourceRecordEnvelope,
  shouldJournalSourceRecord,
  type SourceRecordWriteMetadata,
} from './source-record.js';

export type HostedRecordKind =
  | 'agent'
  | 'delegation'
  | 'contract'
  | 'interaction'
  | 'event'
  | 'receipt'
  | 'feedback'
  | 'counterparty_brief'
  | 'completion_report'
  | 'feedback_request'
  | 'interaction_feedback'
  | 'interaction_conclusion'
  | 'learning_eligibility'
  | 'profile_delta'
  | 'conflict'
  | 'profile'
  | 'consent'
  | 'revocation'
  | 'project'
  | 'agent_profile'
  | 'installation'
  | 'setup_request'
  | 'publication'
  | 'presence'
  | 'shield_case'
  | 'shield_consultation'
  | 'shield_outcome';

export type { PublicAgentCard, FederatedInteraction } from '../../protocol/src/index.js';

type ContextualProfile = {
  recordId: string;
  agentId: string;
  agentVersion: string;
  taskCategory: string;
  sampleSize: number;
  effectiveSampleSize?: number;
  dimensionSampleSizes?: Partial<
    Record<
      | 'completion'
      | 'acceptance'
      | 'specification'
      | 'deadline'
      | 'communication'
      | 'evidence'
      | 'scope'
      | 'correction'
      | 'limitations'
      | 'disputes',
      number
    >
  >;
  updatedAt: string;
  completion: number;
  acceptance: number;
  specification: number;
  deadline: number;
  communication: number;
  evidence: number;
  scope: number;
  correction: number;
  limitations: number;
  disputes: number;
};

const FEEDBACK_DIMENSIONS = FeedbackDimensionSchema.options;

function feedbackWindowMilliseconds() {
  const configured = Number(process.env.OPENCLASP_FEEDBACK_WINDOW_MINUTES ?? 120);
  const minutes = Number.isFinite(configured) ? Math.max(15, Math.min(1440, configured)) : 120;
  return minutes * 60_000;
}

function reviewerCredibility(feedback: InteractionFeedback): number {
  const provenance =
    feedback.submissionMethod === 'agent_signature'
      ? 0.9
      : feedback.submissionMethod === 'runtime_session'
        ? 0.8
        : feedback.submissionMethod === 'agent_access_token'
          ? 0.75
          : 0.65;
  return Math.min(1, provenance + (feedback.evidenceReferences.length ? 0.1 : 0));
}

function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type AssuranceLearningSummary = {
  sampleSize: number;
  averageBrierScore?: number;
  questionFamilies: Array<{
    questionFamily: AssuranceEffectivenessEvaluation['questionScores'][number]['questionFamily'];
    sampleSize: number;
    riskRevealRate: number;
    predictiveAccuracy: number;
    averageAbsolutePredictionDelta: number;
    utilityScore: number;
  }>;
  safeguardTypes: Array<{
    type: AssuranceEffectivenessEvaluation['safeguardScores'][number]['type'];
    sampleSize: number;
    positiveOutcomeRate: number;
  }>;
};

function summarizeAssuranceLearning(
  evaluations: AssuranceEffectivenessEvaluation[],
): AssuranceLearningSummary {
  const predictionScores = evaluations.flatMap((evaluation) => evaluation.predictionScores);
  const questionGroups = new Map<
    string,
    {
      questionFamily: AssuranceLearningSummary['questionFamilies'][number]['questionFamily'];
      sampleSize: number;
      riskReveals: number;
      predictiveScore: number;
      absolutePredictionDelta: number;
    }
  >();
  for (const evaluation of evaluations) {
    for (const question of evaluation.questionScores) {
      const group = questionGroups.get(question.questionFamily) ?? {
        questionFamily: question.questionFamily,
        sampleSize: 0,
        riskReveals: 0,
        predictiveScore: 0,
        absolutePredictionDelta: 0,
      };
      group.sampleSize += 1;
      if (question.exposedMaterialRisk) group.riskReveals += 1;
      const predictedOutcome = question.exposedMaterialRisk ? 0 : 1;
      group.predictiveScore += 1 - Math.abs(predictedOutcome - evaluation.outcomeValue);
      group.absolutePredictionDelta += Math.abs(question.predictionDelta);
      questionGroups.set(question.questionFamily, group);
    }
  }
  const safeguardGroups = new Map<
    string,
    {
      type: AssuranceLearningSummary['safeguardTypes'][number]['type'];
      sampleSize: number;
      positive: number;
    }
  >();
  for (const safeguard of evaluations.flatMap((evaluation) => evaluation.safeguardScores)) {
    if (safeguard.status !== 'accepted' && safeguard.status !== 'modified') continue;
    const group = safeguardGroups.get(safeguard.type) ?? {
      type: safeguard.type,
      sampleSize: 0,
      positive: 0,
    };
    group.sampleSize += 1;
    if (safeguard.outcomeAssociation === 'positive') group.positive += 1;
    safeguardGroups.set(safeguard.type, group);
  }
  return {
    sampleSize: evaluations.length,
    ...(predictionScores.length
      ? {
          averageBrierScore:
            predictionScores.reduce((sum, score) => sum + score.brierScore, 0) /
            predictionScores.length,
        }
      : {}),
    questionFamilies: [...questionGroups.values()]
      .map((group) => {
        const riskRevealRate = (group.riskReveals + 1) / (group.sampleSize + 2);
        const predictiveAccuracy = (group.predictiveScore + 1) / (group.sampleSize + 2);
        const averageAbsolutePredictionDelta = group.absolutePredictionDelta / group.sampleSize;
        return {
          questionFamily: group.questionFamily,
          sampleSize: group.sampleSize,
          riskRevealRate,
          predictiveAccuracy,
          averageAbsolutePredictionDelta,
          utilityScore: Math.min(
            1,
            riskRevealRate * 0.4 +
              predictiveAccuracy * 0.5 +
              Math.min(1, averageAbsolutePredictionDelta * 4) * 0.1,
          ),
        };
      })
      .sort((left, right) => right.utilityScore - left.utilityScore),
    safeguardTypes: [...safeguardGroups.values()]
      .map((group) => ({
        type: group.type,
        sampleSize: group.sampleSize,
        positiveOutcomeRate: (group.positive + 1) / (group.sampleSize + 2),
      }))
      .sort((left, right) => right.positiveOutcomeRate - left.positiveOutcomeRate),
  };
}

function assuranceClaimComparison(
  answer: AssuranceProbeResponse['answers'][number],
  report: InteractionCompletionReport,
) {
  const code = answer.questionCode;
  const claim = answer.answer;
  const normalized = String(claim).toLowerCase();
  const positive = ['true', 'yes', 'complete', 'all', 'accurate'].includes(normalized);
  const partial = ['partially', 'partial', 'some'].includes(normalized);
  const negative = ['false', 'no', 'none'].includes(normalized);
  const observedOutcome = `${report.outcome}: ${report.summary}`.slice(0, 500);
  let status: 'aligned' | 'partially_aligned' | 'contradicted' | 'unverifiable' = 'unverifiable';
  if (/capability|commitment|complete|deliver|deadline/.test(code)) {
    if (report.outcome === 'success')
      status = positive
        ? 'aligned'
        : partial
          ? 'partially_aligned'
          : negative
            ? 'contradicted'
            : 'unverifiable';
    if (report.outcome === 'partial')
      status = partial ? 'aligned' : positive || negative ? 'partially_aligned' : 'unverifiable';
    if (report.outcome === 'failure' || report.outcome === 'cancelled')
      status = negative
        ? 'aligned'
        : partial
          ? 'partially_aligned'
          : positive
            ? 'contradicted'
            : 'unverifiable';
  } else if (/evidence/.test(code)) {
    const evidenceProvided = report.evidenceReferences.length > 0;
    status = evidenceProvided
      ? negative
        ? 'contradicted'
        : positive
          ? 'aligned'
          : 'partially_aligned'
      : positive
        ? 'contradicted'
        : negative
          ? 'aligned'
          : 'unverifiable';
  } else if (/depend|blocker|approval|tool/.test(code)) {
    const blockersObserved = report.blockers.length > 0;
    status =
      normalized === 'none'
        ? blockersObserved
          ? 'contradicted'
          : 'aligned'
        : blockersObserved
          ? 'aligned'
          : 'unverifiable';
  }
  return {
    questionCode: code,
    preTaskClaim: claim,
    observedOutcome,
    status,
    evidenceReferences: [
      ...new Set([...answer.evidenceReferences, ...report.evidenceReferences]),
    ].slice(0, 10),
  };
}

function normalizePublicAgentCard(value: unknown): PublicAgentCard {
  const current = PublicAgentCardSchema.safeParse(value);
  const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
    /\/$/,
    '',
  );
  if (current.success) {
    const slug = current.data.slug ?? publicAgentSlug(current.data.name, current.data.agentId);
    return PublicAgentCardSchema.parse({
      ...current.data,
      slug,
      profileUrl: `${baseUrl}/a/${encodeURIComponent(slug)}`,
      cardUrl: `${baseUrl}/agents/${encodeURIComponent(current.data.agentId)}/card.json`,
      a2aAgentCardUrl: `${baseUrl}/agents/${encodeURIComponent(current.data.agentId)}/a2a-agent-card.json`,
      extensionUri: current.data.extensionUri ?? DEFAULT_EXTENSION_URI,
      verification: {
        ...(current.data.verification ?? {
          status: 'verified',
          method: 'openclasp_oauth_account',
          verifiedAt: current.data.publishedAt,
        }),
        verificationKeyUrl: `${baseUrl}/.well-known/openclasp-session-key`,
      },
    });
  }
  const legacy = value as Record<string, unknown>;
  const agentId = String(legacy.agentId ?? '');
  const slug = publicAgentSlug(String(legacy.name ?? agentId), agentId);
  return PublicAgentCardSchema.parse({
    protocolVersion: '0.1',
    agentId,
    name: legacy.name,
    description: '',
    framework: legacy.framework,
    agentVersion: '1.0.0',
    capabilities: legacy.capabilities,
    limitations: legacy.limitations,
    assurance: legacy.assurance,
    transports:
      typeof legacy.a2aEndpoint === 'string'
        ? [
            {
              protocol: 'A2A/1.0',
              protocolBinding: 'JSONRPC',
              endpoint: legacy.a2aEndpoint,
              managedBy: 'agent',
            },
          ]
        : [],
    slug,
    profileUrl: `${baseUrl}/a/${encodeURIComponent(slug)}`,
    cardUrl: `${baseUrl}/agents/${encodeURIComponent(agentId)}/card.json`,
    a2aAgentCardUrl: `${baseUrl}/agents/${encodeURIComponent(agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
    verification: {
      status: 'verified',
      method: 'openclasp_oauth_account',
      verifiedAt: legacy.publishedAt,
      verificationKeyUrl: `${baseUrl}/.well-known/openclasp-session-key`,
    },
    publishedAt: legacy.publishedAt,
    updatedAt: legacy.updatedAt,
  });
}

function publicAgentSlug(name: string, agentId: string) {
  const prefix =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'agent';
  const suffix = createHash('sha256').update(agentId).digest('hex').slice(0, 8);
  return `${prefix}-${suffix}`;
}

export function buildPublicAgentCard(
  agent: AgentProfile,
  baseUrl: string,
  previous?: PublicAgentCard,
): PublicAgentCard {
  const now = new Date().toISOString();
  const root = baseUrl.replace(/\/$/, '');
  const slug = previous?.slug ?? publicAgentSlug(agent.name, agent.agentId);
  return PublicAgentCardSchema.parse({
    protocolVersion: '0.1',
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description ?? '',
    framework: agent.framework,
    agentVersion: agent.agentVersion ?? '1.0.0',
    capabilities: agent.capabilities,
    limitations: agent.limitations,
    assurance: 'oauth_authenticated',
    agentMode: 'persistent_runtime',
    transports: agent.a2aEndpoint
      ? [
          {
            protocol: 'A2A/1.0',
            protocolBinding: 'JSONRPC',
            endpoint: agent.a2aEndpoint,
            managedBy: 'agent',
          },
        ]
      : [],
    slug,
    profileUrl: `${root}/a/${encodeURIComponent(slug)}`,
    cardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/card.json`,
    a2aAgentCardUrl: `${root}/agents/${encodeURIComponent(agent.agentId)}/a2a-agent-card.json`,
    extensionUri: DEFAULT_EXTENSION_URI,
    verification: {
      status: 'verified',
      method: 'openclasp_oauth_account',
      verifiedAt: previous?.verification?.verifiedAt ?? previous?.publishedAt ?? now,
      verificationKeyUrl: `${root}/.well-known/openclasp-session-key`,
    },
    publishedAt: previous?.publishedAt ?? now,
    updatedAt: now,
  });
}

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

export const AGENT_ONLINE_WINDOW_MS = 2 * 60_000;

export function resolveAgentPresence(lastSeenAt?: string, now = new Date()): AgentPresence {
  const online = Boolean(
    lastSeenAt && now.getTime() - Date.parse(lastSeenAt) <= AGENT_ONLINE_WINDOW_MS,
  );
  return {
    status: online ? 'online' : 'offline',
    ...(lastSeenAt ? { lastSeenAt } : {}),
    checkedAt: now.toISOString(),
  };
}

export function canAutoAcceptInteraction(
  agent: AgentProfile,
  interaction: FederatedInteraction,
): boolean {
  if (agent.autoAcceptPolicy !== 'safe_matching' || agent.status !== 'active') return false;
  const categories = new Set(
    [...(agent.autoAcceptTaskCategories ?? []), ...(agent.capabilities ?? [])].map(normalized),
  );
  const taskCategory = normalized(interaction.contract.taskCategory);
  if (!taskCategory || !categories.has(taskCategory)) return false;
  if (interaction.contract.allowedData.length > 0) return false;
  if (
    /\b(password|secret|api[_ -]?key|access[_ -]?token|credential|bank|payment|medical|health|ssn|personal[_ -]?data|customer[_ -]?record)\b/i.test(
      `${interaction.contract.purpose} ${interaction.contract.requestedOutcome}`,
    )
  )
    return false;
  if (interaction.contract.humanApprovalRequirements.length > 0) return false;
  if (interaction.contract.retentionDays > 30) return false;
  if (interaction.contract.allowedActions.length > 0) {
    const capabilities = new Set((agent.capabilities ?? []).map(normalized));
    if (
      !interaction.contract.allowedActions.every((action) => capabilities.has(normalized(action)))
    )
      return false;
  }
  return true;
}

function withContractRevisionHistory(value: FederatedInteraction): FederatedInteraction {
  if (value.contractRevisions.length) return value;
  const status =
    value.status === 'pending'
      ? 'proposed'
      : ['active', 'completed'].includes(value.status)
        ? 'accepted'
        : 'rejected';
  const revision = ContractRevisionSchema.parse({
    revisionId: deterministicUuid(`${value.interactionId}:contract:1:${value.termsHash}`),
    interactionId: value.interactionId,
    revision: value.contractRevision,
    termsHash: value.termsHash,
    contract: value.contract,
    proposedByAgentId: value.initiatorAgentId,
    status,
    acceptances: value.acceptances,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
  });
  return FederatedInteractionSchema.parse({ ...value, contractRevisions: [revision] });
}

function openContractRevision(value: FederatedInteraction): ContractRevision | undefined {
  return [...value.contractRevisions].reverse().find((revision) => revision.status === 'proposed');
}

export type AccountSettings = {
  displayName: string;
  contributionEnabled: boolean;
  rawConversationsStored: false;
};

const defaults: AccountSettings = {
  displayName: '',
  contributionEnabled: false,
  rawConversationsStored: false,
};

export class HostedRepository {
  private readonly sql: NeonQueryFunction<false, false>;
  private initialized?: Promise<void>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private gatewaySecret() {
    const value = process.env.OPENCLASP_RELAY_ENCRYPTION_KEY;
    if (!value || value.length < 32) throw new Error('Gateway encryption is not configured');
    return value;
  }

  private gatewaySecrets() {
    const active = this.gatewaySecret();
    const previous = (process.env.OPENCLASP_RELAY_PREVIOUS_KEYS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (previous.some((value) => value.length < 32))
      throw new Error('A previous gateway key is too short');
    if (previous.length > 3) throw new Error('At most three previous gateway keys are supported');
    return [...new Set([active, ...previous])];
  }

  private decryptGatewayPayload(encrypted: { ciphertext: string; iv: string; authTag: string }) {
    for (const secret of this.gatewaySecrets()) {
      try {
        return decryptGatewayPayload(secret, encrypted);
      } catch {
        // Try retained rotation keys without exposing which key failed.
      }
    }
    throw new Error('Encrypted gateway payload could not be decrypted');
  }

  private verifySessionGrant(token: string) {
    for (const secret of this.gatewaySecrets()) {
      try {
        return verifySessionGrant(secret, token);
      } catch {
        // Short-lived sessions remain valid during an orderly key rotation.
      }
    }
    throw new Error('Invalid or expired live-session credential');
  }

  private attestPublicAgentCard(value: PublicAgentCard): PublicAgentCard {
    const unsigned = { ...value };
    delete unsigned.platformAttestation;
    return PublicAgentCardSchema.parse({
      ...unsigned,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), unsigned),
    });
  }

  ensureSchema(): Promise<void> {
    return (this.initialized ??= verifyHostedMigrations(this.sql));
  }

  private connectorClaimFromRow(row: Record<string, any>): ConnectorClaim {
    return {
      claimId: String(row.claim_id),
      secretHash: String(row.secret_hash),
      runtimeEndpoint: String(row.runtime_endpoint),
      credentialPublicKey: String(row.credential_public_key),
      profile: row.profile,
      status: row.status,
      ...(row.operator_id ? { operatorId: String(row.operator_id) } : {}),
      ...(row.agent_id ? { agentId: String(row.agent_id) } : {}),
      ...(row.credential_ciphertext
        ? { credentialCiphertext: String(row.credential_ciphertext) }
        : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      ...(row.decided_at ? { decidedAt: new Date(String(row.decided_at)).toISOString() } : {}),
      ...(row.connected_at
        ? { connectedAt: new Date(String(row.connected_at)).toISOString() }
        : {}),
    };
  }

  private providerConnectionFromRow(row: Record<string, any>): ProviderConnection {
    return {
      connectionId: String(row.connection_id),
      operatorId: String(row.operator_id),
      provider: row.provider,
      agentName: String(row.agent_name),
      codeHash: String(row.code_hash),
      status: row.status,
      ...(row.agent_id ? { agentId: String(row.agent_id) } : {}),
      ...(row.runtime_endpoint ? { runtimeEndpoint: String(row.runtime_endpoint) } : {}),
      ...(row.credential_public_key
        ? { credentialPublicKey: String(row.credential_public_key) }
        : {}),
      ...(row.credential_ciphertext
        ? { credentialCiphertext: String(row.credential_ciphertext) }
        : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      ...(row.connected_at
        ? { connectedAt: new Date(String(row.connected_at)).toISOString() }
        : {}),
    };
  }

  async createProviderConnection(operatorId: string, provider: 'botpress', agentName: string) {
    await this.ensureSchema();
    await this.sql`
      DELETE FROM openclasp_provider_connections
      WHERE expires_at < NOW() - INTERVAL '7 days'
    `;
    const { connection, code } = createProviderConnectionInput(operatorId, provider, agentName);
    await this.sql`
      INSERT INTO openclasp_provider_connections(
        connection_id, operator_id, provider, agent_name, code_hash, status, expires_at, created_at
      ) VALUES (
        ${connection.connectionId}, ${connection.operatorId}, ${connection.provider},
        ${connection.agentName}, ${connection.codeHash}, 'pending',
        ${connection.expiresAt}, ${connection.createdAt}
      )
    `;
    return { ...publicProviderConnection(connection), code };
  }

  async getProviderConnection(operatorId: string, connectionId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM openclasp_provider_connections
      WHERE connection_id = ${connectionId} AND operator_id = ${operatorId}
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('Provider connection not found');
    const connection = this.providerConnectionFromRow(rows[0]);
    if (connection.status === 'pending' && Date.parse(connection.expiresAt) <= Date.now()) {
      await this.sql`
        UPDATE openclasp_provider_connections SET status = 'expired'
        WHERE connection_id = ${connectionId} AND status = 'pending'
      `;
      connection.status = 'expired';
    }
    return publicProviderConnection(connection);
  }

  async completeBotpressConnection(
    code: string,
    input: {
      runtimeEndpoint: string;
      credentialPublicKey: string;
      profile: import('../../protocol/src/index.js').ConnectorAgentProfile;
    },
  ) {
    await this.ensureSchema();
    const codeHash = hashProviderConnectionCode(code);
    const rows = await this.sql`
      SELECT * FROM openclasp_provider_connections
      WHERE code_hash = ${codeHash} AND provider = 'botpress'
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('Invalid Botpress pairing code');
    const connection = this.providerConnectionFromRow(rows[0]);
    if (Date.parse(connection.expiresAt) <= Date.now()) {
      await this.sql`
        UPDATE openclasp_provider_connections SET status = 'expired'
        WHERE connection_id = ${connection.connectionId} AND status = 'pending'
      `;
      throw new Error('Botpress pairing code expired');
    }
    if (connection.status === 'connected') {
      if (!connection.agentId || !connection.credentialCiphertext)
        throw new Error('Botpress connection is incomplete');
      return {
        agentId: connection.agentId,
        credentialCiphertext: connection.credentialCiphertext,
        status: 'connected' as const,
      };
    }
    if (connection.status !== 'pending') throw new Error('Botpress pairing code is unavailable');
    await resolvePublicRuntimeEndpoint(input.runtimeEndpoint);
    const { agent } = await createConnectorAgent(
      this,
      connection.operatorId,
      connection.agentName,
      { ...input.profile, framework: 'Botpress' },
    );
    const accessToken = await this.issueAgentAccessToken(connection.operatorId, agent.agentId, {
      name: 'Botpress',
      expiresInDays: 365,
    });
    const credentialCiphertext = encryptConnectorCredential(
      input.credentialPublicKey,
      accessToken.token,
    );
    await this.sql`
      UPDATE openclasp_provider_connections
      SET status = 'connected', agent_id = ${agent.agentId},
          runtime_endpoint = ${input.runtimeEndpoint},
          credential_public_key = ${input.credentialPublicKey},
          credential_ciphertext = ${credentialCiphertext}, connected_at = NOW()
      WHERE connection_id = ${connection.connectionId} AND status = 'pending'
    `;
    return { agentId: agent.agentId, credentialCiphertext, status: 'connected' as const };
  }

  async createConnectorClaim(input: {
    runtimeEndpoint: string;
    credentialPublicKey: string;
    profile: import('../../protocol/src/index.js').ConnectorAgentProfile;
  }) {
    await this.ensureSchema();
    await this.sql`
      DELETE FROM openclasp_connector_claims
      WHERE expires_at < NOW() - INTERVAL '7 days'
    `;
    await resolvePublicRuntimeEndpoint(input.runtimeEndpoint);
    const { claim, claimSecret } = createConnectorClaimInput(input);
    await this.sql`
      INSERT INTO openclasp_connector_claims(
        claim_id, secret_hash, runtime_endpoint, credential_public_key, profile,
        status, expires_at, created_at
      ) VALUES (
        ${claim.claimId}, ${claim.secretHash}, ${claim.runtimeEndpoint},
        ${claim.credentialPublicKey}, ${JSON.stringify(claim.profile)}::jsonb,
        'pending', ${claim.expiresAt}, ${claim.createdAt}
      )
    `;
    return { ...publicConnectorClaim(claim), claimSecret };
  }

  async getConnectorClaim(claimId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM openclasp_connector_claims WHERE claim_id = ${claimId} LIMIT 1
    `;
    if (!rows[0]) throw new Error('Connector claim not found');
    const claim = this.connectorClaimFromRow(rows[0]);
    if (
      (claim.status === 'pending' || claim.status === 'approved') &&
      connectorClaimExpired(claim)
    ) {
      await this.sql`
        UPDATE openclasp_connector_claims SET status = 'expired', credential_ciphertext = NULL
        WHERE claim_id = ${claimId} AND status IN ('pending', 'approved')
      `;
      if (claim.agentId)
        await this.sql`
          UPDATE openclasp_agent_access_tokens SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE agent_id = ${claim.agentId} AND name = 'Runtime connector'
        `;
      claim.status = 'expired';
    }
    return publicConnectorClaim(claim);
  }

  async pollConnectorClaim(claimId: string, claimSecret: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM openclasp_connector_claims WHERE claim_id = ${claimId} LIMIT 1
    `;
    if (!rows[0]) throw new Error('Connector claim not found');
    const claim = this.connectorClaimFromRow(rows[0]);
    if (!matchesConnectorClaimSecret(claim.secretHash, claimSecret))
      throw new Error('Invalid connector claim secret');
    if (
      (claim.status === 'pending' || claim.status === 'approved') &&
      connectorClaimExpired(claim)
    ) {
      await this.sql`
        UPDATE openclasp_connector_claims SET status = 'expired', credential_ciphertext = NULL
        WHERE claim_id = ${claimId} AND status IN ('pending', 'approved')
      `;
      if (claim.agentId)
        await this.sql`
          UPDATE openclasp_agent_access_tokens SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE agent_id = ${claim.agentId} AND name = 'Runtime connector'
        `;
      return { status: 'expired' as const };
    }
    return {
      status: claim.status,
      ...(claim.agentId ? { agentId: claim.agentId } : {}),
      ...(claim.credentialCiphertext ? { credentialCiphertext: claim.credentialCiphertext } : {}),
    };
  }

  async approveConnectorClaim(operatorId: string, claimId: string, name: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM openclasp_connector_claims WHERE claim_id = ${claimId} LIMIT 1
    `;
    if (!rows[0]) throw new Error('Connector claim not found');
    const claim = this.connectorClaimFromRow(rows[0]);
    if (connectorClaimExpired(claim)) throw new Error('Connector claim expired');
    if (claim.status === 'rejected') throw new Error('Connector claim was rejected');
    if (claim.status !== 'pending') {
      if (claim.operatorId !== operatorId)
        throw new Error('Connector claim belongs to another account');
      return publicConnectorClaim(claim);
    }
    const reserved = await this.sql`
      UPDATE openclasp_connector_claims
      SET status = 'approved', operator_id = ${operatorId}, decided_at = NOW()
      WHERE claim_id = ${claimId} AND status = 'pending' AND expires_at > NOW()
      RETURNING claim_id
    `;
    if (!reserved.length) throw new Error('Connector claim is no longer pending');
    try {
      const { agent } = await createConnectorAgent(this, operatorId, name, claim.profile);
      const accessToken = await this.issueAgentAccessToken(operatorId, agent.agentId, {
        name: 'Runtime connector',
        expiresInDays: 365,
      });
      const credentialCiphertext = encryptConnectorCredential(
        claim.credentialPublicKey,
        accessToken.token,
      );
      await this.sql`
        UPDATE openclasp_connector_claims
        SET agent_id = ${agent.agentId}, credential_ciphertext = ${credentialCiphertext}
        WHERE claim_id = ${claimId} AND operator_id = ${operatorId}
      `;
      return {
        ...publicConnectorClaim({
          ...claim,
          status: 'approved',
          operatorId,
          agentId: agent.agentId,
          credentialCiphertext,
          decidedAt: new Date().toISOString(),
        }),
        agent,
      };
    } catch (error) {
      await this.sql`
        UPDATE openclasp_connector_claims
        SET status = 'rejected', credential_ciphertext = NULL
        WHERE claim_id = ${claimId} AND operator_id = ${operatorId} AND agent_id IS NULL
      `;
      throw error;
    }
  }

  async rejectConnectorClaim(operatorId: string, claimId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_connector_claims
      SET status = 'rejected', operator_id = ${operatorId}, decided_at = NOW()
      WHERE claim_id = ${claimId} AND status = 'pending' AND expires_at > NOW()
      RETURNING *
    `;
    if (!rows[0]) throw new Error('Connector claim is no longer pending');
    return publicConnectorClaim(this.connectorClaimFromRow(rows[0]));
  }

  async completeConnectorClaim(agentId: string) {
    await this.ensureSchema();
    await this.sql`
      UPDATE openclasp_connector_claims
      SET status = 'connected', credential_ciphertext = NULL, connected_at = NOW()
      WHERE agent_id = ${agentId} AND status = 'approved'
    `;
  }

  private async appendSourceRecord(
    operatorId: string,
    kind: string,
    recordId: string,
    payload: unknown,
    metadata?: SourceRecordWriteMetadata,
  ) {
    const source = buildSourceRecordEnvelope({
      operatorId,
      kind,
      recordId,
      payload,
      ...(metadata ? { metadata } : {}),
    });
    await this.sql`
      INSERT INTO openclasp_source_records(
        event_id, operator_id, kind, record_id, schema_name, schema_version, payload,
        payload_digest, entity_refs, provenance, visibility, retention_class, learning_scope,
        reported_at, ingested_at
      ) VALUES (
        ${source.eventId}, ${source.operatorId}, ${source.kind}, ${source.recordId},
        ${source.schemaName}, ${source.schemaVersion}, ${JSON.stringify(source.payload)}::jsonb,
        ${source.payloadDigest}, ${JSON.stringify(source.entityRefs)}::jsonb,
        ${source.provenance}, ${source.visibility}, ${source.retentionClass},
        ${source.learningScope}, ${source.reportedAt}, ${source.ingestedAt}
      )
      ON CONFLICT (operator_id, kind, record_id, payload_digest) DO NOTHING
    `;
  }

  private async interactionOperatorIds(interactionId: string): Promise<string[]> {
    const rows = await this.sql`
      SELECT initiator_operator_id, responder_operator_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
      LIMIT 1
    `;
    if (!rows[0]) return [];
    return [
      ...new Set([String(rows[0].initiator_operator_id), String(rows[0].responder_operator_id)]),
    ];
  }

  private async journalFederatedInteraction(interactionId: string) {
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
      LIMIT 1
    `;
    if (!rows[0]) return;
    const payload = FederatedInteractionSchema.parse(rows[0].payload);
    const operatorIds = [
      ...new Set([String(rows[0].initiator_operator_id), String(rows[0].responder_operator_id)]),
    ];
    await Promise.all(
      operatorIds.map((operatorId) =>
        this.appendSourceRecord(operatorId, 'federated_interaction', interactionId, payload, {
          schemaName: 'openclasp.federated_interaction',
          schemaVersion: '0.1',
          visibility: 'shared_participants',
          retentionClass: 'audit',
        }),
      ),
    );
  }

  private async journalLiveSessionState(interactionId: string) {
    const rows = await this.sql`
      SELECT session.interaction_id, session.initiator_agent_id, session.responder_agent_id,
        session.status, session.expires_at, session.created_at, session.activated_at,
        session.completed_at, interaction.initiator_operator_id,
        interaction.responder_operator_id
      FROM openclasp_live_sessions session
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id = session.interaction_id
      WHERE session.interaction_id = ${interactionId}
      LIMIT 1
    `;
    if (!rows[0]) return;
    const row = rows[0];
    const payload = LiveSessionStateRecordSchema.parse({
      interactionId: String(row.interaction_id),
      initiatorAgentId: String(row.initiator_agent_id),
      responderAgentId: String(row.responder_agent_id),
      status: String(row.status),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      createdAt: new Date(String(row.created_at)).toISOString(),
      ...(row.activated_at
        ? { activatedAt: new Date(String(row.activated_at)).toISOString() }
        : {}),
      ...(row.completed_at
        ? { completedAt: new Date(String(row.completed_at)).toISOString() }
        : {}),
      ...(row.status === 'failed' ? { failureCode: 'session_failed' } : {}),
    });
    const operatorIds = [
      ...new Set([String(row.initiator_operator_id), String(row.responder_operator_id)]),
    ];
    await Promise.all(
      operatorIds.map((operatorId) =>
        this.appendSourceRecord(operatorId, 'live_session_state', interactionId, payload, {
          schemaName: 'openclasp.live_session_state',
          schemaVersion: '0.1',
          visibility: 'shared_participants',
          retentionClass: 'audit',
          reportedAt: payload.completedAt ?? payload.activatedAt ?? payload.createdAt,
        }),
      ),
    );
  }

  private async journalLiveSessionEvent(payload: Record<string, unknown>) {
    const interactionId = String(payload.interactionId ?? '');
    const eventId = String(payload.eventId ?? '');
    if (!interactionId || !eventId) return;
    const operatorIds = await this.interactionOperatorIds(interactionId);
    await Promise.all(
      operatorIds.map((operatorId) =>
        this.appendSourceRecord(operatorId, 'live_session_event', eventId, payload, {
          schemaName: 'openclasp.live_session_event',
          schemaVersion: '0.1',
          visibility: 'shared_participants',
          retentionClass: 'audit',
        }),
      ),
    );
  }

  getRuntimeVerificationKey() {
    const [active, ...previous] = this.gatewaySecrets();
    return {
      algorithm: 'Ed25519' as const,
      keyId: getSessionKeyId(active!),
      publicKey: getSessionVerificationKey(active!),
      previousKeys: previous.map((secret) => ({
        algorithm: 'Ed25519' as const,
        keyId: getSessionKeyId(secret),
        publicKey: getSessionVerificationKey(secret),
      })),
    };
  }

  async upsert(
    operatorId: string,
    kind: HostedRecordKind,
    recordId: string,
    payload: unknown,
    metadata?: SourceRecordWriteMetadata,
  ): Promise<void> {
    await this.ensureSchema();
    const encoded = JSON.stringify(payload);
    if (!(metadata?.journal ?? shouldJournalSourceRecord(kind))) {
      await this.sql`
        INSERT INTO openclasp_records(operator_id, kind, record_id, payload)
        VALUES (${operatorId}, ${kind}, ${recordId}, ${encoded}::jsonb)
        ON CONFLICT (operator_id, kind, record_id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `;
      return;
    }
    const source = buildSourceRecordEnvelope({
      operatorId,
      kind,
      recordId,
      payload,
      ...(metadata ? { metadata } : {}),
    });
    const sourcePayload = JSON.stringify(source.payload);
    const sourceEntityRefs = JSON.stringify(source.entityRefs);
    await this.sql.transaction((transaction) => [
      transaction`
        INSERT INTO openclasp_records(operator_id, kind, record_id, payload)
        VALUES (${operatorId}, ${kind}, ${recordId}, ${encoded}::jsonb)
        ON CONFLICT (operator_id, kind, record_id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `,
      transaction`
        INSERT INTO openclasp_source_records(
          event_id,
          operator_id,
          kind,
          record_id,
          schema_name,
          schema_version,
          payload,
          payload_digest,
          entity_refs,
          provenance,
          visibility,
          retention_class,
          learning_scope,
          reported_at,
          ingested_at
        ) VALUES (
          ${source.eventId},
          ${source.operatorId},
          ${source.kind},
          ${source.recordId},
          ${source.schemaName},
          ${source.schemaVersion},
          ${sourcePayload}::jsonb,
          ${source.payloadDigest},
          ${sourceEntityRefs}::jsonb,
          ${source.provenance},
          ${source.visibility},
          ${source.retentionClass},
          ${source.learningScope},
          ${source.reportedAt},
          ${source.ingestedAt}
        )
        ON CONFLICT (operator_id, kind, record_id, payload_digest) DO NOTHING
      `,
    ]);
  }

  async list(
    operatorId: string,
  ): Promise<{ kind: HostedRecordKind; recordId: string; payload: any }[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT kind, record_id, payload
      FROM openclasp_records
      WHERE operator_id = ${operatorId}
      ORDER BY created_at ASC
    `;
    return rows.map((row) => ({
      kind: row.kind as HostedRecordKind,
      recordId: String(row.record_id),
      payload: row.payload,
    }));
  }

  async saveShieldCase(operatorId: string, value: ShieldCase): Promise<ShieldCase> {
    const caseRecord = ShieldCaseSchema.parse(value);
    await this.upsert(operatorId, 'shield_case', caseRecord.caseId, caseRecord, {
      journal: true,
      schemaName: 'openclasp.shield.case',
      schemaVersion: '1',
      entityRefs: { caseId: caseRecord.caseId, agentId: caseRecord.agentId },
      retentionClass: 'audit',
      learningScope: 'local_only',
    });
    return caseRecord;
  }

  async getShieldCase(operatorId: string, caseId: string): Promise<ShieldCase | undefined> {
    const row = (await this.list(operatorId)).find(
      (record) => record.kind === 'shield_case' && record.recordId === caseId,
    );
    if (!row) return undefined;
    return ShieldCaseSchema.parse(row.payload);
  }

  async listShieldCases(operatorId: string, agentId?: string): Promise<ShieldCase[]> {
    return (await this.list(operatorId))
      .filter((record) => record.kind === 'shield_case')
      .map((record) => ShieldCaseSchema.parse(record.payload))
      .filter((caseRecord) => !agentId || caseRecord.agentId === agentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveShieldConsultation(
    operatorId: string,
    value: ShieldConsultation,
  ): Promise<ShieldConsultation> {
    const consultation = ShieldConsultationSchema.parse(value);
    await this.upsert(
      operatorId,
      'shield_consultation',
      consultation.consultationId,
      consultation,
      {
        journal: true,
        schemaName: 'openclasp.shield.consultation',
        schemaVersion: '1',
        entityRefs: {
          caseId: consultation.caseId,
          agentId: consultation.agentId,
          consultationId: consultation.consultationId,
        },
        retentionClass: 'audit',
        learningScope: 'local_only',
      },
    );
    return consultation;
  }

  async listShieldConsultations(operatorId: string, caseId: string): Promise<ShieldConsultation[]> {
    return (await this.list(operatorId))
      .filter((record) => record.kind === 'shield_consultation')
      .map((record) => ShieldConsultationSchema.parse(record.payload))
      .filter((consultation) => consultation.caseId === caseId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveShieldOutcome(operatorId: string, value: ShieldOutcome): Promise<ShieldOutcome> {
    const outcome = ShieldOutcomeSchema.parse(value);
    await this.upsert(operatorId, 'shield_outcome', outcome.outcomeId, outcome, {
      journal: true,
      schemaName: 'openclasp.shield.outcome',
      schemaVersion: '1',
      entityRefs: {
        caseId: outcome.caseId,
        agentId: outcome.agentId,
        outcomeId: outcome.outcomeId,
      },
      retentionClass: 'audit',
      learningScope: 'local_only',
    });
    return outcome;
  }

  async dashboard(operatorId: string) {
    await this.ensureSchema();
    const dueFeedback = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND payload->>'status' = 'pending'
        AND (payload->>'dueAt')::timestamptz <= NOW()
      LIMIT 1
    `;
    if (dueFeedback.length) await this.processDueFeedback().catch(() => undefined);
    const outstanding = await this.sql`
      SELECT DISTINCT report.payload->>'interactionId' AS interaction_id
      FROM openclasp_records report
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id::text = report.payload->>'interactionId'
      WHERE report.kind = 'completion_report'
        AND (
          interaction.initiator_operator_id = ${operatorId}
          OR interaction.responder_operator_id = ${operatorId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM openclasp_records conclusion
          WHERE conclusion.operator_id = ${operatorId}
            AND conclusion.kind = 'interaction_conclusion'
            AND conclusion.payload->>'interactionId' = report.payload->>'interactionId'
        )
      LIMIT 20
    `;
    for (const row of outstanding) {
      const interactionId = String(row.interaction_id ?? '');
      if (interactionId)
        await this.finalizeInteractionConclusion(interactionId).catch(() => undefined);
    }
    const intelligenceBackfill = await this.sql`
      SELECT DISTINCT interaction.interaction_id
      FROM openclasp_federated_interactions interaction
      INNER JOIN openclasp_records conclusion
        ON conclusion.payload->>'interactionId' = interaction.interaction_id::text
        AND conclusion.kind = 'interaction_conclusion'
        AND conclusion.payload->>'lifecycle' = 'final'
      WHERE (
          interaction.initiator_operator_id = ${operatorId}
          OR interaction.responder_operator_id = ${operatorId}
        )
        AND EXISTS (
          SELECT 1 FROM openclasp_records eligibility
          WHERE eligibility.kind = 'learning_eligibility'
            AND eligibility.payload->>'interactionId' = interaction.interaction_id::text
            AND eligibility.payload->>'eligible' = 'true'
        )
        AND NOT EXISTS (
          SELECT 1 FROM openclasp_records delta
          WHERE delta.operator_id = ${operatorId}
            AND delta.kind = 'profile_delta'
            AND delta.payload->>'interactionId' = interaction.interaction_id::text
            AND delta.payload->>'agentId' = CASE
              WHEN interaction.initiator_operator_id = ${operatorId}
                THEN interaction.initiator_agent_id::text
              ELSE interaction.responder_agent_id::text
            END
        )
      ORDER BY interaction.interaction_id DESC
      LIMIT 20
    `;
    for (const row of intelligenceBackfill) {
      const interactionId = String(row.interaction_id ?? '');
      if (interactionId)
        await this.finalizeInteractionConclusion(interactionId).catch(() => undefined);
    }
    const rows = await this.list(operatorId);
    const [
      federatedInteractions,
      runtimes,
      accessTokens,
      liveSessionRows,
      liveEventRows,
      assuranceAssessmentRows,
      assurancePredictionRows,
      assuranceSafeguardRows,
      assuranceEvaluationRows,
      assurancePlanRows,
      assuranceResponseRows,
    ] = await Promise.all([
      this.listFederatedInteractions(operatorId),
      this.listAgentRuntimes(operatorId),
      this.listAgentAccessTokens(operatorId),
      this.sql`
        SELECT session.interaction_id, session.initiator_agent_id, session.responder_agent_id,
          session.status, session.created_at, session.activated_at, session.completed_at,
          session.expires_at, session.last_error
        FROM openclasp_live_sessions session
        INNER JOIN openclasp_federated_interactions interaction
          ON interaction.interaction_id = session.interaction_id
        WHERE interaction.initiator_operator_id = ${operatorId}
           OR interaction.responder_operator_id = ${operatorId}
        ORDER BY session.created_at DESC
      `,
      this.sql`
        SELECT events.event
        FROM openclasp_live_session_events events
        INNER JOIN openclasp_federated_interactions interaction
          ON interaction.interaction_id = events.interaction_id
        WHERE interaction.initiator_operator_id = ${operatorId}
           OR interaction.responder_operator_id = ${operatorId}
        ORDER BY events.created_at ASC
      `,
      this
        .sql`SELECT payload FROM openclasp_assurance_assessments WHERE operator_id = ${operatorId} ORDER BY created_at ASC`,
      this
        .sql`SELECT payload FROM openclasp_assurance_predictions WHERE operator_id = ${operatorId} ORDER BY created_at ASC`,
      this
        .sql`SELECT payload FROM openclasp_assurance_safeguards WHERE operator_id = ${operatorId} ORDER BY created_at ASC`,
      this
        .sql`SELECT payload FROM openclasp_assurance_evaluations WHERE operator_id = ${operatorId} ORDER BY created_at ASC`,
      this
        .sql`SELECT payload FROM openclasp_assurance_probe_plans WHERE operator_id = ${operatorId} ORDER BY created_at ASC`,
      this
        .sql`SELECT responses.payload FROM openclasp_assurance_probe_responses responses INNER JOIN openclasp_assurance_probe_plans plans ON plans.plan_id = responses.plan_id WHERE plans.operator_id = ${operatorId} ORDER BY responses.created_at ASC`,
    ]);
    const ofKind = (kind: HostedRecordKind) =>
      rows.filter((row) => row.kind === kind).map((row) => row.payload);
    const presence = new Map(
      rows
        .filter((row) => row.kind === 'presence')
        .map((row) => [row.recordId, String(row.payload.lastSeenAt)]),
    );
    const intelligenceSummaries = await this.listContextualIntelligence(operatorId);
    return {
      agents: [...ofKind('agent_profile'), ...ofKind('agent')].map((agent) => ({
        ...agent,
        presence: resolveAgentPresence(presence.get(String(agent.agentId))),
      })),
      projects: ofKind('project'),
      installations: ofKind('installation'),
      setupRequests: ofKind('setup_request'),
      publications: ofKind('publication'),
      interactions: ofKind('interaction'),
      events: [...ofKind('event'), ...liveEventRows.map((row) => row.event)],
      conflicts: ofKind('conflict'),
      receipts: ofKind('receipt'),
      profiles: ofKind('profile'),
      counterpartyBriefs: ofKind('counterparty_brief'),
      completionReports: ofKind('completion_report'),
      feedbackRequests: ofKind('feedback_request'),
      interactionFeedback: ofKind('interaction_feedback'),
      interactionConclusions: ofKind('interaction_conclusion'),
      learningEligibility: ofKind('learning_eligibility'),
      profileDeltas: ofKind('profile_delta'),
      intelligenceSummaries,
      assuranceAssessments: assuranceAssessmentRows.map((row) => row.payload),
      assurancePredictions: assurancePredictionRows.map((row) => row.payload),
      assuranceSafeguards: assuranceSafeguardRows.map((row) => row.payload),
      assuranceEvaluations: assuranceEvaluationRows.map((row) => row.payload),
      assuranceProbePlans: assurancePlanRows.map((row) => row.payload),
      assuranceProbeResponses: assuranceResponseRows.map((row) => row.payload),
      shieldCases: ofKind('shield_case'),
      shieldConsultations: ofKind('shield_consultation'),
      shieldOutcomes: ofKind('shield_outcome'),
      federatedInteractions,
      liveSessions: liveSessionRows.map((row) => ({
        interactionId: String(row.interaction_id),
        initiatorAgentId: String(row.initiator_agent_id),
        responderAgentId: String(row.responder_agent_id),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString(),
        ...(row.activated_at
          ? { activatedAt: new Date(String(row.activated_at)).toISOString() }
          : {}),
        ...(row.completed_at
          ? { completedAt: new Date(String(row.completed_at)).toISOString() }
          : {}),
        expiresAt: new Date(String(row.expires_at)).toISOString(),
        ...(row.last_error ? { lastError: String(row.last_error) } : {}),
      })),
      runtimes,
      accessTokens,
    };
  }

  async listContextualIntelligence(
    operatorId: string,
    input: { agentId?: string; taskCategory?: string } = {},
  ) {
    await this.ensureSchema();
    const [records, publicRows] = await Promise.all([
      this.list(operatorId),
      this
        .sql`SELECT agent_id, card FROM openclasp_public_agents ORDER BY updated_at DESC LIMIT 1000`,
    ]);
    const currentVersions = new Map<string, string>();
    for (const row of publicRows) {
      const card = PublicAgentCardSchema.safeParse(normalizePublicAgentCard(row.card));
      if (card.success) currentVersions.set(String(row.agent_id), card.data.agentVersion);
    }
    for (const record of records.filter((item) => item.kind === 'agent_profile')) {
      const profile = record.payload as Partial<AgentProfile>;
      if (typeof profile.agentId === 'string' && typeof profile.agentVersion === 'string')
        currentVersions.set(profile.agentId, profile.agentVersion);
    }
    const deltas = records
      .filter((record) => record.kind === 'profile_delta')
      .map((record) => BehaviouralProfileDeltaSchema.safeParse(record.payload))
      .filter((result) => result.success)
      .map((result) => result.data);
    return records
      .filter((record) => record.kind === 'profile')
      .map((record) => ({ recordId: record.recordId, ...record.payload }) as ContextualProfile)
      .filter(
        (profile) =>
          (!input.agentId || profile.agentId === input.agentId) &&
          (!input.taskCategory || profile.taskCategory === input.taskCategory),
      )
      .map((profile) =>
        summarizeContextualReliability({
          profile: {
            ...profile,
            effectiveSampleSize: profile.effectiveSampleSize ?? profile.sampleSize,
          },
          deltas: deltas.filter(
            (delta) =>
              delta.agentId === profile.agentId &&
              delta.agentVersion === profile.agentVersion &&
              delta.taskCategory === profile.taskCategory,
          ),
          currentAgentVersion: currentVersions.get(profile.agentId) ?? profile.agentVersion,
        }),
      )
      .sort((left, right) => {
        if (left.agentId !== right.agentId) return left.agentId.localeCompare(right.agentId);
        if (left.versionStatus.status !== right.versionStatus.status)
          return left.versionStatus.status === 'current' ? -1 : 1;
        return right.confidence.value - left.confidence.value;
      });
  }

  async issueAgentAccessToken(
    operatorId: string,
    agentId: string,
    input: { name: string; expiresInDays: number; scopes?: OpenClaspAuthScope[] },
  ): Promise<AgentAccessTokenMetadata & { token: string }> {
    await this.ensureSchema();
    const agents = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const agent = agents[0]?.payload as AgentProfile | undefined;
    if (!agent) throw new Error('Owned agent not found');
    if (agent.status !== 'active') throw new Error('Revoked agents cannot receive access tokens');
    const name = input.name.trim();
    if (!name) throw new Error('Token name is required');
    const { tokenId, token, tokenHash } = createAgentAccessToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + input.expiresInDays * 86_400_000);
    // The credential is bound to one agent. Callers may further reduce its default
    // scopes for a specific integration, but cannot grant unsupported scopes.
    const scopes = input.scopes ?? DEFAULT_AGENT_AUTH_SCOPES;
    if (!scopes.length || scopes.some((scope) => !DEFAULT_AGENT_AUTH_SCOPES.includes(scope)))
      throw new Error('Agent access token contains an unsupported scope');
    await this.sql`
      INSERT INTO openclasp_agent_access_tokens(
        token_id, operator_id, agent_id, name, token_hash, scopes, expires_at, created_at
      ) VALUES (
        ${tokenId}, ${operatorId}, ${agentId}, ${name}, ${tokenHash},
        ${JSON.stringify(scopes)}::jsonb, ${expiresAt.toISOString()}, ${createdAt.toISOString()}
      )
    `;
    const clientId = agentAccessTokenClientId(tokenId);
    await this.upsert(operatorId, 'installation', clientId, {
      installationId: `install_${tokenId}`,
      clientId,
      agentId,
      projectId: agent.projectId,
      connectedAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    } satisfies AgentInstallation);
    return {
      tokenId,
      token,
      agentId,
      name,
      scopes,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listAgentAccessTokens(
    operatorId: string,
    agentId?: string,
  ): Promise<AgentAccessTokenMetadata[]> {
    await this.ensureSchema();
    const rows = agentId
      ? await this.sql`
          SELECT token_id, agent_id, name, scopes, expires_at, last_used_at, revoked_at, created_at
          FROM openclasp_agent_access_tokens
          WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
          ORDER BY created_at DESC
        `
      : await this.sql`
          SELECT token_id, agent_id, name, scopes, expires_at, last_used_at, revoked_at, created_at
          FROM openclasp_agent_access_tokens
          WHERE operator_id = ${operatorId}
          ORDER BY created_at DESC
        `;
    return rows.map((row) => ({
      tokenId: String(row.token_id),
      agentId: String(row.agent_id),
      name: String(row.name),
      scopes: Array.isArray(row.scopes)
        ? row.scopes.filter((scope): scope is string => typeof scope === 'string')
        : [],
      createdAt: new Date(String(row.created_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      ...(row.last_used_at ? { lastUsedAt: new Date(String(row.last_used_at)).toISOString() } : {}),
      ...(row.revoked_at ? { revokedAt: new Date(String(row.revoked_at)).toISOString() } : {}),
    }));
  }

  async revokeAgentAccessToken(operatorId: string, agentId: string, tokenId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_agent_access_tokens
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE token_id = ${tokenId} AND operator_id = ${operatorId} AND agent_id = ${agentId}
      RETURNING revoked_at
    `;
    if (!rows.length) throw new Error('Agent access token not found');
    const clientId = agentAccessTokenClientId(tokenId);
    await this.sql`
      DELETE FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'installation' AND record_id = ${clientId}
    `;
    return {
      tokenId,
      agentId,
      revokedAt: new Date(String(rows[0]?.revoked_at)).toISOString(),
    };
  }

  async verifyAgentAccessToken(token: string) {
    await this.ensureSchema();
    const tokenId = agentAccessTokenId(token);
    if (!tokenId) throw new Error('Invalid agent access token');
    const rows = await this.sql`
      SELECT tokens.operator_id, tokens.agent_id, tokens.token_hash, tokens.scopes,
        tokens.expires_at, profile.payload AS profile
      FROM openclasp_agent_access_tokens tokens
      INNER JOIN openclasp_records profile
        ON profile.operator_id = tokens.operator_id
        AND profile.kind = 'agent_profile'
        AND profile.record_id = tokens.agent_id
      WHERE tokens.token_id = ${tokenId} AND tokens.revoked_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || !matchesAgentAccessToken(token, String(row.token_hash)))
      throw new Error('Invalid agent access token');
    if (Date.parse(String(row.expires_at)) <= Date.now())
      throw new Error('Agent access token has expired');
    const profile = row.profile as Partial<AgentProfile>;
    if (profile.status !== 'active') throw new Error('Agent access token is disabled');
    await this.sql`
      UPDATE openclasp_agent_access_tokens
      SET last_used_at = NOW()
      WHERE token_id = ${tokenId}
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')
    `;
    return {
      tokenId,
      operatorId: String(row.operator_id),
      agentId: String(row.agent_id),
      clientId: agentAccessTokenClientId(tokenId),
      scopes: Array.isArray(row.scopes)
        ? row.scopes.filter((scope): scope is string => typeof scope === 'string')
        : [],
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
  }

  async publishAgent(operatorId: string, card: PublicAgentCard): Promise<PublicAgentCard> {
    await this.ensureSchema();
    card = PublicAgentCardSchema.parse(card);
    const runtimes = await this.sql`
      SELECT a2a_endpoint, endpoint FROM openclasp_agent_runtimes
      WHERE operator_id = ${operatorId} AND agent_id = ${card.agentId} AND status = 'verified'
    `;
    if (!runtimes[0]) throw new Error('Connect and verify the agent runtime before publishing');
    card = PublicAgentCardSchema.parse({
      ...card,
      agentMode: 'persistent_runtime',
      transports: [
        {
          protocol: 'A2A/1.0',
          protocolBinding: 'JSONRPC',
          endpoint: String(runtimes[0].a2a_endpoint ?? runtimes[0].endpoint),
          managedBy: 'agent',
        },
      ],
    });
    card = this.attestPublicAgentCard(card);
    const encoded = JSON.stringify(card);
    const rows = await this.sql`
      INSERT INTO openclasp_public_agents(agent_id, operator_id, card, published_at, updated_at)
      VALUES (${card.agentId}, ${operatorId}, ${encoded}::jsonb, NOW(), NOW())
      ON CONFLICT (agent_id) DO UPDATE SET
        card = EXCLUDED.card,
        updated_at = NOW()
      WHERE openclasp_public_agents.operator_id = ${operatorId}
      RETURNING card
    `;
    const published = rows[0]?.card as PublicAgentCard | undefined;
    if (!published) throw new Error('Agent ID is already owned by another operator');
    return PublicAgentCardSchema.parse(published);
  }

  async unpublishAgent(operatorId: string, agentId: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.sql`
      DELETE FROM openclasp_public_agents
      WHERE agent_id = ${agentId} AND operator_id = ${operatorId}
      RETURNING agent_id
    `;
    return rows.length > 0;
  }

  async getPublishedAgent(agentId: string): Promise<PublicAgentCard | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT agents.card, runtime.a2a_endpoint, runtime.endpoint, profile.payload AS profile
      FROM openclasp_public_agents agents
      INNER JOIN openclasp_agent_runtimes runtime
        ON runtime.agent_id = agents.agent_id AND runtime.status = 'verified'
      LEFT JOIN openclasp_records profile
        ON profile.operator_id = agents.operator_id AND profile.kind = 'agent_profile'
        AND profile.record_id = agents.agent_id
      WHERE agents.agent_id = ${agentId}
    `;
    if (!rows[0]?.card) return undefined;
    const card = PublicAgentCardSchema.parse({
      ...normalizePublicAgentCard(rows[0].card),
      agentMode: 'persistent_runtime',
      transports: [
        {
          protocol: 'A2A/1.0',
          protocolBinding: 'JSONRPC',
          endpoint: String(rows[0].a2a_endpoint ?? rows[0].endpoint),
          managedBy: 'agent',
        },
      ],
    });
    return this.attestPublicAgentCard({ ...card, presence: await this.getAgentPresence(agentId) });
  }

  async resolveAgentReference(reference: string): Promise<AgentResolution | undefined> {
    await this.ensureSchema();
    const normalizedReference = reference.trim().replace(/\/$/, '');
    if (!normalizedReference || normalizedReference.length > 2048)
      throw new Error('Agent reference is invalid');
    const rows = await this.sql`
      SELECT agent_id, card
      FROM openclasp_public_agents
      WHERE agent_id = ${normalizedReference}
        OR card->>'slug' = ${normalizedReference}
        OR RTRIM(card->>'profileUrl', '/') = ${normalizedReference}
        OR RTRIM(card->>'cardUrl', '/') = ${normalizedReference}
        OR RTRIM(card->>'a2aAgentCardUrl', '/') = ${normalizedReference}
      LIMIT 1
    `;
    let row = rows[0];
    if (!row) {
      const legacyRows = await this.sql`
        SELECT agent_id, card
        FROM openclasp_public_agents
        ORDER BY updated_at DESC
        LIMIT 1000
      `;
      row = legacyRows.find((candidate) => {
        const card = normalizePublicAgentCard(candidate.card);
        return [card.slug, card.profileUrl, card.cardUrl, card.a2aAgentCardUrl]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.replace(/\/$/, '') === normalizedReference);
      });
    }
    if (!row) return undefined;
    const stored = normalizePublicAgentCard(row.card);
    const matchedBy =
      String(row.agent_id) === normalizedReference
        ? 'agent_id'
        : stored.slug === normalizedReference
          ? 'slug'
          : stored.profileUrl?.replace(/\/$/, '') === normalizedReference
            ? 'profile_url'
            : stored.cardUrl.replace(/\/$/, '') === normalizedReference
              ? 'card_url'
              : 'a2a_card_url';
    const card = await this.getPublishedAgent(String(row.agent_id));
    if (!card) return undefined;
    return AgentResolutionSchema.parse({
      reference,
      matchedBy,
      verified: true,
      card,
      resolvedAt: new Date().toISOString(),
    });
  }

  async searchPublishedAgents(input: {
    query?: string | undefined;
    capability?: string | undefined;
    limit?: number | undefined;
  }): Promise<PublicAgentCard[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT agents.card, runtime.a2a_endpoint, runtime.endpoint, profile.payload AS profile
      FROM openclasp_public_agents agents
      INNER JOIN openclasp_agent_runtimes runtime
        ON runtime.agent_id = agents.agent_id AND runtime.status = 'verified'
      LEFT JOIN openclasp_records profile
        ON profile.operator_id = agents.operator_id AND profile.kind = 'agent_profile'
        AND profile.record_id = agents.agent_id
      ORDER BY agents.updated_at DESC LIMIT 100
    `;
    const query = input.query?.trim().toLowerCase();
    const capability = input.capability?.trim().toLowerCase();
    const presenceRows = await this.sql`
      SELECT records.record_id, records.payload
      FROM openclasp_records records
      INNER JOIN openclasp_public_agents agents ON agents.agent_id = records.record_id
      WHERE records.kind = 'presence'
    `;
    const presence = new Map(
      presenceRows.map((row) => [String(row.record_id), String(row.payload.lastSeenAt)]),
    );
    return rows
      .map((row) => {
        const card = PublicAgentCardSchema.parse({
          ...normalizePublicAgentCard(row.card),
          agentMode: 'persistent_runtime',
          transports: [
            {
              protocol: 'A2A/1.0',
              protocolBinding: 'JSONRPC',
              endpoint: String(row.a2a_endpoint ?? row.endpoint),
              managedBy: 'agent',
            },
          ],
        });
        return this.attestPublicAgentCard({
          ...card,
          presence: resolveAgentPresence(presence.get(card.agentId)),
        });
      })
      .filter(
        (card) =>
          (!query ||
            card.agentId.toLowerCase().includes(query) ||
            card.slug?.includes(query) ||
            card.name.toLowerCase().includes(query) ||
            card.description.toLowerCase().includes(query) ||
            card.framework.toLowerCase().includes(query) ||
            card.capabilities.some((value) => value.toLowerCase().includes(query)) ||
            card.limitations.some((value) => value.toLowerCase().includes(query))) &&
          (!capability ||
            card.capabilities.some((value) => value.toLowerCase().includes(capability))),
      )
      .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));
  }

  async searchPersonalizedMarketplace(
    operatorId: string,
    input: {
      agentId?: string;
      taskCategory?: string;
      query?: string;
      limit?: number;
    } = {},
  ) {
    const [cards, records, summaries] = await Promise.all([
      this.searchPublishedAgents({ query: input.query, limit: input.limit }),
      this.list(operatorId),
      this.listContextualIntelligence(operatorId, {
        ...(input.taskCategory ? { taskCategory: input.taskCategory } : {}),
      }),
    ]);
    const ownedAgents = records
      .filter((record) => record.kind === 'agent_profile')
      .map((record) => record.payload as Partial<AgentProfile>);
    const ownedIds = new Set(ownedAgents.map((agent) => agent.agentId));
    const selected = ownedAgents.find((agent) => agent.agentId === input.agentId);
    const taskCategory = input.taskCategory ?? selected?.capabilities?.[0] ?? 'general';
    const normalizedCategory = taskCategory.toLowerCase();
    const summaryFor = (agentId: string) =>
      summaries.find(
        (summary) =>
          summary.agentId === agentId &&
          summary.taskCategory.toLowerCase() === normalizedCategory &&
          summary.versionStatus.status === 'current',
      ) ?? summaries.find((summary) => summary.agentId === agentId);
    return cards
      .filter(
        (card) =>
          card.agentMode === 'persistent_runtime' &&
          card.transports.some((transport) => transport.managedBy === 'agent'),
      )
      .filter((card) => !ownedIds.has(card.agentId))
      .map((card) => {
        const intelligence = summaryFor(card.agentId);
        const capabilityMatch = card.capabilities.some((capability) =>
          capability.toLowerCase().includes(normalizedCategory),
        );
        const online = card.presence?.status === 'online';
        const fitScore = Math.min(
          1,
          0.25 +
            (capabilityMatch ? 0.35 : 0) +
            (online ? 0.1 : 0) +
            (intelligence ? intelligence.score * intelligence.confidence.value * 0.3 : 0),
        );
        return {
          card,
          taskCategory,
          ...(intelligence ? { contextualReliability: intelligence } : {}),
          match: {
            score: fitScore,
            label: fitScore >= 0.72 ? 'strong' : fitScore >= 0.48 ? 'possible' : 'unproven',
            reasons: [
              capabilityMatch
                ? `Published capability matches ${taskCategory}`
                : `No explicit ${taskCategory} capability`,
              intelligence
                ? `${intelligence.confidence.evidenceCount} verified outcomes in private history`
                : 'No verified private history for this task',
              online ? 'Currently online' : 'Currently offline',
            ],
          },
        };
      })
      .sort((left, right) => right.match.score - left.match.score);
  }

  async touchAgentPresence(operatorId: string, agentId: string): Promise<AgentPresence> {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    if (!owned.length) throw new Error('Agent is not owned by this account');
    const lastSeenAt = new Date().toISOString();
    await this.upsert(operatorId, 'presence', agentId, { lastSeenAt });
    await this.sql`
      UPDATE openclasp_agent_runtimes SET last_seen_at = ${lastSeenAt}, updated_at = NOW()
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId} AND status = 'verified'
    `;
    return resolveAgentPresence(lastSeenAt);
  }

  async getAgentPresence(agentId: string): Promise<AgentPresence> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT records.payload
      FROM openclasp_public_agents agents
      LEFT JOIN openclasp_records records
        ON records.operator_id = agents.operator_id
        AND records.kind = 'presence'
        AND records.record_id = agents.agent_id
      WHERE agents.agent_id = ${agentId}
      LIMIT 1
    `;
    if (!rows.length) throw new Error('Published agent not found');
    const lastSeenAt = rows[0]?.payload?.lastSeenAt;
    return resolveAgentPresence(typeof lastSeenAt === 'string' ? lastSeenAt : undefined);
  }

  async listAgentRuntimes(operatorId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT agent_id, endpoint, a2a_endpoint, status, verified_at, last_seen_at, last_error, updated_at
      FROM openclasp_agent_runtimes
      WHERE operator_id = ${operatorId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => ({
      agentId: String(row.agent_id),
      endpoint: String(row.endpoint),
      a2aEndpoint: String(row.a2a_endpoint ?? row.endpoint),
      status: row.status as 'verified' | 'disabled',
      verifiedAt: new Date(String(row.verified_at)).toISOString(),
      ...(row.last_seen_at ? { lastSeenAt: new Date(String(row.last_seen_at)).toISOString() } : {}),
      ...(row.last_error ? { lastError: String(row.last_error) } : {}),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async registerAgentRuntime(operatorId: string, agentId: string, endpoint: string) {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    if (!owned.length) throw new Error('Agent is not owned by this account');
    const challenge = crypto.randomUUID();
    const verification = await postRuntimeJson(endpoint, {
      type: 'openclasp.runtime.verify',
      version: '1',
      agentId,
      challenge,
    });
    if (
      verification.status < 200 ||
      verification.status >= 300 ||
      !verification.body ||
      typeof verification.body !== 'object' ||
      (verification.body as { type?: unknown }).type !== 'openclasp.runtime.verified' ||
      (verification.body as { version?: unknown }).version !== '1' ||
      (verification.body as { agentId?: unknown }).agentId !== agentId ||
      (verification.body as { challenge?: unknown }).challenge !== challenge
    )
      throw new Error('Runtime endpoint did not return the verification challenge');
    const a2aEndpointValue = (verification.body as { a2aEndpoint?: unknown }).a2aEndpoint;
    const a2aEndpoint =
      typeof a2aEndpointValue === 'string' && a2aEndpointValue ? a2aEndpointValue : endpoint;
    await resolvePublicRuntimeEndpoint(a2aEndpoint);
    const runtimeSecret = randomBytes(32).toString('base64url');
    const encrypted = encryptGatewayPayload(this.gatewaySecret(), runtimeSecret);
    const verifiedAt = new Date().toISOString();
    const saved = await this.sql`
      INSERT INTO openclasp_agent_runtimes(
        agent_id, operator_id, endpoint, a2a_endpoint, secret_ciphertext, secret_iv, secret_auth_tag,
        status, verified_at, last_seen_at, updated_at
      ) VALUES (
        ${agentId}, ${operatorId}, ${endpoint}, ${a2aEndpoint}, ${encrypted.ciphertext},
        ${encrypted.iv}, ${encrypted.authTag}, 'verified', ${verifiedAt}, ${verifiedAt}, NOW()
      )
      ON CONFLICT (agent_id) DO UPDATE SET
        operator_id = EXCLUDED.operator_id,
        endpoint = EXCLUDED.endpoint,
        a2a_endpoint = EXCLUDED.a2a_endpoint,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        secret_iv = EXCLUDED.secret_iv,
        secret_auth_tag = EXCLUDED.secret_auth_tag,
        status = 'verified',
        verified_at = EXCLUDED.verified_at,
        last_seen_at = EXCLUDED.last_seen_at,
        last_error = NULL,
        updated_at = NOW()
      WHERE openclasp_agent_runtimes.operator_id = ${operatorId}
      RETURNING agent_id
    `;
    if (!saved.length) throw new Error('Agent runtime is owned by another account');
    await this.sql`
      UPDATE openclasp_public_agents
      SET card = jsonb_set(
          jsonb_set(
            card,
            '{transports}',
            ${JSON.stringify([
              {
                protocol: 'A2A/1.0',
                protocolBinding: 'JSONRPC',
                endpoint: a2aEndpoint,
                managedBy: 'agent',
              },
            ])}::jsonb
          ),
          '{agentMode}', '"persistent_runtime"'::jsonb
        ), updated_at = NOW()
      WHERE agent_id = ${agentId} AND operator_id = ${operatorId}
    `;
    await this.sql`
      UPDATE openclasp_records
      SET payload = jsonb_set(
          jsonb_set(payload, '{a2aEndpoint}', to_jsonb(${a2aEndpoint}::text)),
          '{agentMode}', '"persistent_runtime"'::jsonb
        ),
        updated_at = NOW()
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
    `;
    await this.touchAgentPresence(operatorId, agentId);
    await this.completeConnectorClaim(agentId);
    return {
      agentId,
      endpoint,
      a2aEndpoint,
      status: 'verified' as const,
      verifiedAt,
      verificationKey: getSessionVerificationKey(this.gatewaySecret()),
    };
  }

  async disableAgentRuntime(operatorId: string, agentId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE openclasp_agent_runtimes
      SET status = 'disabled', updated_at = NOW()
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
      RETURNING agent_id
    `;
    if (!rows.length) throw new Error('Agent runtime not found');
    await this.sql`
      DELETE FROM openclasp_public_agents
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      UPDATE openclasp_records
      SET payload = jsonb_set(
        jsonb_set(payload, '{published}', 'false'::jsonb),
        '{updatedAt}', to_jsonb(${new Date().toISOString()}::text)
      ), updated_at = NOW()
      WHERE operator_id = ${operatorId} AND kind = 'publication' AND record_id = ${agentId}
    `;
    return { agentId, status: 'disabled' as const, unpublished: true as const };
  }

  async deleteAgent(operatorId: string, agentId: string) {
    await this.ensureSchema();
    const owned = await this.sql`
      SELECT 1 FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'agent_profile'
        AND record_id = ${agentId}
      LIMIT 1
    `;
    if (!owned.length) throw new Error('Owned agent not found');
    const openInteractions = await this.sql`
      SELECT interaction_id FROM openclasp_federated_interactions
      WHERE (initiator_agent_id = ${agentId} OR responder_agent_id = ${agentId})
        AND status IN ('pending', 'active')
      LIMIT 1
    `;
    if (openInteractions.length) {
      const error = new Error('Finish or reject the agent’s open interactions before deleting it');
      Object.assign(error, { statusCode: 409 });
      throw error;
    }
    await this.sql`
      DELETE FROM openclasp_public_agents
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_agent_runtimes
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_agent_access_tokens
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_provider_connections
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_connector_claims
      WHERE operator_id = ${operatorId} AND agent_id = ${agentId}
    `;
    await this.sql`
      DELETE FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND (
          (record_id = ${agentId} AND kind IN ('agent', 'agent_profile', 'publication', 'presence'))
          OR (kind = 'installation' AND payload->>'agentId' = ${agentId})
          OR (kind = 'setup_request' AND payload->>'existingAgentId' = ${agentId})
        )
    `;
    return {
      agentId,
      deleted: true as const,
      historyRetained: true as const,
    };
  }

  private async sessionParticipant(agentId: string) {
    const rows = await this.sql`
      SELECT agents.operator_id, agents.card, profile.payload AS profile,
        runtime.endpoint, runtime.a2a_endpoint
      FROM openclasp_public_agents agents
      LEFT JOIN openclasp_records profile
        ON profile.operator_id = agents.operator_id
        AND profile.kind = 'agent_profile'
        AND profile.record_id = agents.agent_id
      INNER JOIN openclasp_agent_runtimes runtime
        ON runtime.agent_id = agents.agent_id AND runtime.status = 'verified'
      WHERE agents.agent_id = ${agentId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error(`Published agent ${agentId} was not found`);
    const card = normalizePublicAgentCard(row.card);
    if (!row.endpoint) throw new Error(`Agent ${agentId} does not have a verified live runtime`);
    return {
      agentId,
      operatorId: String(row.operator_id),
      mode: 'persistent_runtime' as const,
      callbackEndpoint: String(row.endpoint),
      a2aEndpoint: String(row.a2a_endpoint ?? row.endpoint),
      card: PublicAgentCardSchema.parse({ ...card, agentMode: 'persistent_runtime' }),
    };
  }

  private async signedRuntimeRequest(
    runtime: { callbackEndpoint: string },
    requestId: string,
    value: unknown,
  ) {
    const body = JSON.stringify(value);
    const timestamp = new Date().toISOString();
    return postRuntimeJson(runtime.callbackEndpoint, value, {
      'openclasp-request-id': requestId,
      'openclasp-timestamp': timestamp,
      'openclasp-signature': `v1=${signSessionControl(this.gatewaySecret(), requestId, timestamp, body)}`,
    });
  }

  private sessionGrant(
    interaction: FederatedInteraction,
    senderAgentId: string,
    recipientAgentId: string,
  ) {
    return issueSessionGrant(this.gatewaySecret(), {
      interactionId: interaction.interactionId,
      senderAgentId,
      recipientAgentId,
      expiresAt: Math.min(Date.parse(interaction.expiresAt), Date.now() + 60 * 60_000),
    });
  }

  private async privateCounterpartyInsights(
    viewerOperatorId: string,
    counterparty: { agentId: string; card: PublicAgentCard },
    taskCategory: string,
  ): Promise<{
    insights: LiveSessionInsight[];
    relevantSampleSize: number;
    historyConfidence: number;
  }> {
    const rows = await this.sql`
      SELECT record_id, payload
      FROM openclasp_records
      WHERE operator_id = ${viewerOperatorId}
        AND kind = 'profile'
        AND payload->>'agentId' = ${counterparty.agentId}
        AND payload->>'taskCategory' = ${taskCategory}
      ORDER BY (payload->>'sampleSize')::integer DESC, updated_at DESC
    `;
    const profiles: ContextualProfile[] = rows
      .map<Record<string, unknown>>((row) => ({
        recordId: String(row.record_id),
        ...(row.payload as Record<string, unknown>),
      }))
      .filter(
        (profile) =>
          typeof profile.agentVersion === 'string' &&
          typeof profile.sampleSize === 'number' &&
          typeof profile.updatedAt === 'string' &&
          typeof profile.completion === 'number' &&
          typeof profile.acceptance === 'number' &&
          typeof profile.specification === 'number' &&
          typeof profile.deadline === 'number' &&
          typeof profile.communication === 'number' &&
          typeof profile.evidence === 'number' &&
          typeof profile.scope === 'number' &&
          typeof profile.disputes === 'number',
      ) as ContextualProfile[];
    const exact = profiles.find(
      (profile) => profile.agentVersion === counterparty.card.agentVersion,
    );
    const current = exact ?? profiles[0];
    const insights: LiveSessionInsight[] = [];
    let relevantSampleSize = 0;
    let historyConfidence = 0;
    if (!current) {
      insights.push({
        code: 'limited_verified_history',
        severity: 'caution',
        message: `No eligible ${taskCategory} history is available for this agent version. Ask for task-relevant evidence.`,
        evidenceReferences: [],
        requirementReferences: [],
      });
    } else {
      const ageDays = Math.max(
        0,
        (Date.now() - Date.parse(String(current.updatedAt))) / 86_400_000,
      );
      const freshness = Math.exp(-ageDays / 180);
      const sampleSize = Number(current.sampleSize);
      const effectiveSampleSize = Number(current.effectiveSampleSize ?? sampleSize);
      const versionChanged = current.agentVersion !== counterparty.card.agentVersion;
      const confidence = Math.min(
        0.95,
        (effectiveSampleSize / (effectiveSampleSize + 5)) * freshness * (versionChanged ? 0.35 : 1),
      );
      relevantSampleSize = sampleSize;
      historyConfidence = confidence;
      const reference = `openclasp:profile:${current.recordId}`;
      insights.push({
        code: versionChanged ? 'version_history_only' : 'contextual_history',
        severity: versionChanged || confidence < 0.25 ? 'caution' : 'info',
        message: versionChanged
          ? `Only prior-version ${taskCategory} history is available (${sampleSize} eligible interaction${sampleSize === 1 ? '' : 's'}); confidence is reduced for version ${counterparty.card.agentVersion}.`
          : `Based on ${sampleSize} eligible ${taskCategory} interaction${sampleSize === 1 ? '' : 's'}; confidence ${(confidence * 100).toFixed(0)}%.`,
        evidenceReferences: [reference],
        requirementReferences: [],
      });
      const weakDimensions = [
        ['completion', Number(current.completion)],
        ['output acceptance', Number(current.acceptance)],
        ['specification adherence', Number(current.specification)],
        ['deadline reliability', Number(current.deadline)],
        ['communication quality', Number(current.communication)],
        ['evidence quality', Number(current.evidence)],
        ['scope adherence', Number(current.scope)],
      ].filter(([, score]) => Number(score) < 0.7);
      if (weakDimensions.length)
        insights.push({
          code: 'historical_weaknesses',
          severity: weakDimensions.some(([, score]) => Number(score) < 0.5) ? 'high' : 'caution',
          message: `Observed weaker areas: ${weakDimensions
            .map(([name, score]) => `${String(name)} ${(Number(score) * 100).toFixed(0)}%`)
            .join(', ')}.`,
          evidenceReferences: [reference],
          requirementReferences: [],
        });
      if (Number(current.disputes) > 0.25)
        insights.push({
          code: 'elevated_dispute_history',
          severity: Number(current.disputes) >= 0.5 ? 'high' : 'caution',
          message: `Eligible feedback shows a ${(Number(current.disputes) * 100).toFixed(0)}% dispute rate in this task category.`,
          evidenceReferences: [reference],
          requirementReferences: [],
        });
    }
    if (counterparty.card.limitations.length)
      insights.push({
        code: 'declared_limitations',
        severity: 'info',
        message: `Counterparty declares: ${counterparty.card.limitations.join('; ')}`,
        evidenceReferences: [counterparty.card.cardUrl],
        requirementReferences: [],
      });
    return { insights, relevantSampleSize, historyConfidence };
  }

  async brokerLiveSession(interaction: FederatedInteraction) {
    await this.ensureSchema();
    const existing = await this.sql`
      SELECT status FROM openclasp_live_sessions
      WHERE interaction_id = ${interaction.interactionId}
    `;
    if (existing[0]?.status === 'active') return;
    const [initiator, responder] = await Promise.all([
      this.sessionParticipant(interaction.initiatorAgentId),
      this.sessionParticipant(interaction.responderAgentId),
    ]);
    const [initiatorContext, responderContext] = await Promise.all([
      this.privateCounterpartyInsights(
        initiator.operatorId,
        responder,
        interaction.contract.taskCategory,
      ),
      this.privateCounterpartyInsights(
        responder.operatorId,
        initiator,
        interaction.contract.taskCategory,
      ),
    ]);
    const issuedAt = new Date().toISOString();
    const initiatorBrief = buildCounterpartyBrief({
      interactionId: interaction.interactionId,
      contractHash: interaction.termsHash,
      contract: interaction.contract,
      recipientAgentId: initiator.agentId,
      subject: responder.card,
      historyInsights: initiatorContext.insights,
      relevantSampleSize: initiatorContext.relevantSampleSize,
      historyConfidence: initiatorContext.historyConfidence,
      generatedAt: issuedAt,
      expiresAt: interaction.expiresAt,
    });
    const responderBrief = buildCounterpartyBrief({
      interactionId: interaction.interactionId,
      contractHash: interaction.termsHash,
      contract: interaction.contract,
      recipientAgentId: responder.agentId,
      subject: initiator.card,
      historyInsights: responderContext.insights,
      relevantSampleSize: responderContext.relevantSampleSize,
      historyConfidence: responderContext.historyConfidence,
      generatedAt: issuedAt,
      expiresAt: interaction.expiresAt,
    });
    await Promise.all([
      this.upsert(
        initiator.operatorId,
        'counterparty_brief',
        initiatorBrief.briefId,
        initiatorBrief,
      ),
      this.upsert(
        responder.operatorId,
        'counterparty_brief',
        responderBrief.briefId,
        responderBrief,
      ),
    ]);
    const makeOffer = (
      runtime: typeof initiator,
      counterparty: typeof responder,
      role: 'initiator' | 'responder',
      privateInsights: LiveSessionInsight[],
      counterpartyBrief: CounterpartyBrief,
    ) =>
      LiveSessionOfferSchema.parse({
        type: 'openclasp.session.offer',
        version: '1',
        offerId: crypto.randomUUID(),
        interactionId: interaction.interactionId,
        agentId: runtime.agentId,
        role,
        counterparty: {
          agentId: counterparty.agentId,
          name: counterparty.card.name,
          agentVersion: counterparty.card.agentVersion,
          capabilities: counterparty.card.capabilities,
        },
        contract: interaction.contract,
        contractHash: interaction.termsHash,
        privateInsights,
        counterpartyBrief,
        issuedAt,
        expiresAt: interaction.expiresAt,
      });
    const initiatorOffer = makeOffer(
      initiator,
      responder,
      'initiator',
      initiatorBrief.insights,
      initiatorBrief,
    );
    const responderOffer = makeOffer(
      responder,
      initiator,
      'responder',
      responderBrief.insights,
      responderBrief,
    );
    const prepare = async (
      participant: typeof initiator,
      offer: typeof initiatorOffer,
      label: 'Initiator' | 'Responder',
    ) => {
      if (!participant.callbackEndpoint) throw new Error(`${label} runtime is not configured`);
      const response = await this.signedRuntimeRequest(
        { callbackEndpoint: participant.callbackEndpoint },
        offer.offerId,
        offer,
      );
      if (response.status < 200 || response.status >= 300)
        throw new Error(`${label} runtime is not live (HTTP ${response.status})`);
      return LiveSessionAcceptanceSchema.parse(response.body);
    };
    const [initiatorAcceptance, responderAcceptance] = await Promise.all([
      prepare(initiator, initiatorOffer, 'Initiator'),
      prepare(responder, responderOffer, 'Responder'),
    ]);
    if (
      initiatorAcceptance.offerId !== initiatorOffer.offerId ||
      initiatorAcceptance.agentId !== initiator.agentId ||
      responderAcceptance.offerId !== responderOffer.offerId ||
      responderAcceptance.agentId !== responder.agentId
    )
      throw new Error('Runtime returned a mismatched live-session acceptance');
    await Promise.all([
      ...(initiator.mode === 'persistent_runtime'
        ? [resolvePublicRuntimeEndpoint(initiatorAcceptance.a2aEndpoint)]
        : []),
      ...(responder.mode === 'persistent_runtime'
        ? [resolvePublicRuntimeEndpoint(responderAcceptance.a2aEndpoint)]
        : []),
    ]);
    await this.sql`
      INSERT INTO openclasp_live_sessions(
        interaction_id, initiator_agent_id, responder_agent_id,
        initiator_session_id, responder_session_id,
        initiator_endpoint, responder_endpoint, status, expires_at
      ) VALUES (
        ${interaction.interactionId}, ${interaction.initiatorAgentId}, ${interaction.responderAgentId},
        ${initiatorAcceptance.sessionId}, ${responderAcceptance.sessionId},
        ${initiatorAcceptance.a2aEndpoint}, ${responderAcceptance.a2aEndpoint},
        'preparing', ${interaction.expiresAt}
      )
      ON CONFLICT (interaction_id) DO UPDATE SET
        initiator_session_id = EXCLUDED.initiator_session_id,
        responder_session_id = EXCLUDED.responder_session_id,
        initiator_endpoint = EXCLUDED.initiator_endpoint,
        responder_endpoint = EXCLUDED.responder_endpoint,
        status = 'preparing', expires_at = EXCLUDED.expires_at,
        activated_at = NULL, completed_at = NULL, last_error = NULL
    `;
    await this.journalLiveSessionState(interaction.interactionId);
    const baseUrl = (process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(
      /\/$/,
      '',
    );
    const activatedAt = new Date().toISOString();
    const verificationKey = getSessionVerificationKey(this.gatewaySecret());
    const makeActivation = (
      agentId: string,
      sessionId: string,
      role: 'initiator' | 'responder',
      peerAgentId: string,
      peerSessionId: string,
      peerEndpoint: string,
      privateInsights: LiveSessionInsight[],
      counterpartyBrief: CounterpartyBrief,
    ): LiveSessionActivation => {
      const bearerToken = this.sessionGrant(interaction, agentId, peerAgentId);
      return LiveSessionActivationSchema.parse({
        type: 'openclasp.session.activation',
        version: '1',
        activationId: crypto.randomUUID(),
        interactionId: interaction.interactionId,
        agentId,
        sessionId,
        role,
        peer: {
          agentId: peerAgentId,
          sessionId: peerSessionId,
          endpoint: peerEndpoint,
          bearerToken,
          verificationKey,
        },
        reporting: {
          endpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/events`,
          completionEndpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/completion-reports`,
          feedbackEndpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/feedback`,
          assuranceResponseEndpoint: `${baseUrl}/sessions/${encodeURIComponent(interaction.interactionId)}/assurance-responses`,
          bearerToken,
        },
        privateInsights,
        counterpartyBrief,
        contractHash: interaction.termsHash,
        activatedAt,
        expiresAt: interaction.expiresAt,
      });
    };
    const initiatorActivation = makeActivation(
      initiator.agentId,
      initiatorAcceptance.sessionId,
      'initiator',
      responder.agentId,
      responderAcceptance.sessionId,
      responderAcceptance.a2aEndpoint,
      initiatorBrief.insights,
      initiatorBrief,
    );
    const responderActivation = makeActivation(
      responder.agentId,
      responderAcceptance.sessionId,
      'responder',
      initiator.agentId,
      initiatorAcceptance.sessionId,
      initiatorAcceptance.a2aEndpoint,
      responderBrief.insights,
      responderBrief,
    );
    try {
      const activate = async (
        participant: typeof initiator,
        activation: LiveSessionActivation,
        label: 'Initiator' | 'Responder',
      ) => {
        if (!participant.callbackEndpoint) throw new Error(`${label} runtime is not configured`);
        const response = await this.signedRuntimeRequest(
          { callbackEndpoint: participant.callbackEndpoint },
          activation.activationId,
          activation,
        );
        if (response.status < 200 || response.status >= 300)
          throw new Error(`${label} activation failed with HTTP ${response.status}`);
      };
      await activate(responder, responderActivation, 'Responder');
      await activate(initiator, initiatorActivation, 'Initiator');
      await this.sql`
        UPDATE openclasp_live_sessions
        SET status = 'active', activated_at = NOW(), last_error = NULL
        WHERE interaction_id = ${interaction.interactionId}
      `;
      await this.journalLiveSessionState(interaction.interactionId);
      await this.sql`
        UPDATE openclasp_agent_runtimes
        SET last_seen_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE agent_id IN (${initiator.agentId}, ${responder.agentId})
      `;
      await Promise.all([
        this.touchAgentPresence(initiator.operatorId, initiator.agentId),
        this.touchAgentPresence(responder.operatorId, responder.agentId),
      ]);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 500) : 'Session activation failed';
      await this.sql`
        UPDATE openclasp_live_sessions SET status = 'failed', last_error = ${reason}
        WHERE interaction_id = ${interaction.interactionId}
      `;
      await this.journalLiveSessionState(interaction.interactionId);
      throw error;
    }
  }

  async getLiveSession(operatorId: string, interactionId: string, agentId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT session.*, interaction.payload,
        initiator.operator_id AS initiator_operator_id,
        responder.operator_id AS responder_operator_id
      FROM openclasp_live_sessions session
      INNER JOIN openclasp_federated_interactions interaction
        ON interaction.interaction_id = session.interaction_id
      INNER JOIN openclasp_public_agents initiator
        ON initiator.agent_id = session.initiator_agent_id
      INNER JOIN openclasp_public_agents responder
        ON responder.agent_id = session.responder_agent_id
      WHERE session.interaction_id = ${interactionId} AND session.status = 'active'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error('Active live session not found');
    const isInitiator = row.initiator_agent_id === agentId;
    const isResponder = row.responder_agent_id === agentId;
    if (!isInitiator && !isResponder) throw new Error('Agent is not a session participant');
    const owner = isInitiator ? row.initiator_operator_id : row.responder_operator_id;
    if (owner !== operatorId) throw new Error('Agent is not owned by this account');
    const interaction = FederatedInteractionSchema.parse(row.payload);
    const peerAgentId = String(isInitiator ? row.responder_agent_id : row.initiator_agent_id);
    const peer = await this.sessionParticipant(peerAgentId);
    const privateContext = await this.privateCounterpartyInsights(
      String(owner),
      peer,
      interaction.contract.taskCategory,
    );
    const briefRows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${String(owner)}
        AND kind = 'counterparty_brief'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'recipientAgentId' = ${agentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const storedBrief = CounterpartyBriefSchema.safeParse(briefRows[0]?.payload);
    const counterpartyBrief = storedBrief.success
      ? storedBrief.data
      : buildCounterpartyBrief({
          interactionId,
          contractHash: interaction.termsHash,
          contract: interaction.contract,
          recipientAgentId: agentId,
          subject: peer.card,
          historyInsights: privateContext.insights,
          relevantSampleSize: privateContext.relevantSampleSize,
          historyConfidence: privateContext.historyConfidence,
          expiresAt: new Date(String(row.expires_at)).toISOString(),
        });
    const bearerToken = this.sessionGrant(interaction, agentId, peerAgentId);
    return {
      type: 'openclasp.session.activation' as const,
      version: '1' as const,
      activationId: crypto.randomUUID(),
      interactionId,
      agentId,
      sessionId: String(isInitiator ? row.initiator_session_id : row.responder_session_id),
      role: isInitiator ? ('initiator' as const) : ('responder' as const),
      peer: {
        agentId: peerAgentId,
        sessionId: String(isInitiator ? row.responder_session_id : row.initiator_session_id),
        endpoint: String(isInitiator ? row.responder_endpoint : row.initiator_endpoint),
        bearerToken,
        verificationKey: getSessionVerificationKey(this.gatewaySecret()),
      },
      reporting: {
        endpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/events`,
        completionEndpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/completion-reports`,
        feedbackEndpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/feedback`,
        assuranceResponseEndpoint: `${(process.env.OPENCLASP_PUBLIC_URL ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/sessions/${encodeURIComponent(interactionId)}/assurance-responses`,
        bearerToken,
      },
      privateInsights: privateContext.insights,
      counterpartyBrief,
      contractHash: interaction.termsHash,
      activatedAt: row.activated_at
        ? new Date(String(row.activated_at)).toISOString()
        : new Date().toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    };
  }

  private async interactionParticipant(operatorId: string, interactionId: string, agentId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
        AND (
          (initiator_operator_id = ${operatorId} AND initiator_agent_id = ${agentId})
          OR (responder_operator_id = ${operatorId} AND responder_agent_id = ${agentId})
        )
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction participant not found for this account');
    const interaction = FederatedInteractionSchema.parse(row.payload);
    const isInitiator = interaction.initiatorAgentId === agentId;
    return {
      interaction,
      counterpartyAgentId: isInitiator
        ? interaction.responderAgentId
        : interaction.initiatorAgentId,
      participantOperatorId: String(
        isInitiator ? row.initiator_operator_id : row.responder_operator_id,
      ),
      counterpartyOperatorId: String(
        isInitiator ? row.responder_operator_id : row.initiator_operator_id,
      ),
    };
  }

  async getCounterpartyBrief(operatorId: string, interactionId: string, agentId: string) {
    await this.interactionParticipant(operatorId, interactionId, agentId);
    const rows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'counterparty_brief'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'recipientAgentId' = ${agentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const parsed = CounterpartyBriefSchema.safeParse(rows[0]?.payload);
    if (!parsed.success) throw new Error('Counterparty brief is not available');
    return parsed.data;
  }

  private async getAssuranceLearning(
    operatorId: string,
    targetAgentId: string,
    targetAgentVersion: string,
    taskCategory: string,
  ) {
    const rows = await this.sql`
      SELECT payload FROM openclasp_assurance_evaluations
      WHERE operator_id = ${operatorId}
        AND target_agent_id = ${targetAgentId}
        AND target_agent_version = ${targetAgentVersion}
        AND task_category = ${taskCategory}
      ORDER BY created_at DESC
      LIMIT 500
    `;
    const evaluations = rows
      .map((row) => AssuranceEffectivenessEvaluationSchema.safeParse(row.payload))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
    return summarizeAssuranceLearning(evaluations);
  }

  async getAssuranceProbeContext(
    operatorId: string,
    interactionId: string,
    generatedForAgentId: string,
    targetAgentId: string,
  ) {
    const participant = await this.interactionParticipant(
      operatorId,
      interactionId,
      generatedForAgentId,
    );
    if (participant.counterpartyAgentId !== targetAgentId)
      throw new Error('Assurance probe target must be the authenticated agent’s counterparty');
    if (participant.interaction.status !== 'active')
      throw new Error('Assurance probes require an active interaction');
    const targetCard = await this.getPublishedAgent(targetAgentId);
    if (!targetCard) throw new Error('Assurance probe target is no longer published');
    const brief = await this.getCounterpartyBrief(
      operatorId,
      interactionId,
      generatedForAgentId,
    ).catch(() => undefined);
    const reportRows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'completion_report'
        AND payload->>'interactionId' = ${interactionId}
      ORDER BY updated_at DESC
    `;
    const completionReports = reportRows
      .map((row) => InteractionCompletionReportSchema.safeParse(row.payload))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
    const eventRows = await this.sql`
      SELECT event FROM openclasp_live_session_events
      WHERE interaction_id = ${interactionId}
      ORDER BY created_at ASC
      LIMIT 100
    `;
    const sessionEvents = eventRows
      .map((row) => LiveSessionEventSchema.safeParse(row.event))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
    const planRows = await this.sql`
      SELECT payload FROM openclasp_assurance_probe_plans
      WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId}
        AND generated_for_agent_id = ${generatedForAgentId} AND target_agent_id = ${targetAgentId}
      ORDER BY created_at ASC
    `;
    const previousPlans = planRows.map((row) => AssuranceProbePlanSchema.parse(row.payload));
    const responseRows = await this.sql`
      SELECT responses.payload FROM openclasp_assurance_probe_responses responses
      INNER JOIN openclasp_assurance_probe_plans plans ON plans.plan_id = responses.plan_id
      WHERE plans.operator_id = ${operatorId} AND responses.interaction_id = ${interactionId}
        AND responses.agent_id = ${targetAgentId}
      ORDER BY responses.created_at ASC
    `;
    const previousResponses = responseRows.map((row) =>
      AssuranceProbeResponseSchema.parse(row.payload),
    );
    const predictionRows = await this.sql`
      SELECT payload FROM openclasp_assurance_predictions
      WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId}
        AND target_agent_id = ${targetAgentId}
      ORDER BY created_at ASC
    `;
    const previousPredictions = predictionRows.map((row) =>
      AssurancePredictionSnapshotSchema.parse(row.payload),
    );
    const assuranceLearning = await this.getAssuranceLearning(
      operatorId,
      targetAgentId,
      targetCard.agentVersion,
      participant.interaction.contract.taskCategory,
    );
    return {
      interaction: participant.interaction,
      targetCard,
      brief,
      completionReports,
      sessionEvents,
      previousPlans,
      previousResponses,
      previousPredictions,
      assuranceLearning,
    };
  }

  async beginAssuranceGeneration(record: {
    generationId: string;
    operatorId: string;
    interactionId: string;
    phase: 'pre_task' | 'post_task';
    model: string;
    promptVersion: string;
    input: Record<string, unknown>;
  }) {
    await this.ensureSchema();
    const participants = await this.sql`
      SELECT 1 FROM openclasp_federated_interactions
      WHERE interaction_id = ${record.interactionId}
        AND ${record.operatorId} IN (initiator_operator_id, responder_operator_id)
      LIMIT 1
    `;
    if (!participants.length) throw new Error('Assurance generation interaction is not accessible');
    await this.sql`
      INSERT INTO openclasp_ai_generations(
        generation_id, operator_id, interaction_id, phase, model, prompt_version,
        status, input, input_digest
      ) VALUES (
        ${record.generationId}, ${record.operatorId}, ${record.interactionId}, ${record.phase},
        ${record.model}, ${record.promptVersion}, 'pending', ${JSON.stringify(record.input)}::jsonb,
        ${canonicalHash(record.input)}
      )
    `;
  }

  async finishAssuranceGeneration(
    operatorId: string,
    generationId: string,
    value: {
      status: 'complete' | 'fallback' | 'error';
      output: AssuranceDecision;
      tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      errorCode?: string;
    },
  ) {
    const rows = await this.sql`
      UPDATE openclasp_ai_generations
      SET status = ${value.status}, output = ${JSON.stringify(value.output)}::jsonb,
        token_usage = ${JSON.stringify(value.tokenUsage ?? {})}::jsonb,
        error_code = ${value.errorCode ?? null}, completed_at = NOW()
      WHERE generation_id = ${generationId} AND operator_id = ${operatorId} AND status = 'pending'
      RETURNING generation_id
    `;
    if (!rows.length) throw new Error('Pending assurance generation not found');
  }

  async saveAssuranceProbePlan(operatorId: string, value: AssuranceProbePlan) {
    const plan = AssuranceProbePlanSchema.parse(value);
    const participant = await this.interactionParticipant(
      operatorId,
      plan.interactionId,
      plan.generatedForAgentId,
    );
    if (participant.counterpartyAgentId !== plan.targetAgentId)
      throw new Error('Assurance probe target does not match the interaction counterparty');
    if (participant.interaction.termsHash !== plan.contractHash)
      throw new Error('Assurance probe contract hash is stale');
    const rows = await this.sql`
      INSERT INTO openclasp_assurance_probe_plans(
        plan_id, generation_id, operator_id, interaction_id, contract_hash, phase,
        generated_for_agent_id, target_agent_id, payload, expires_at
      ) VALUES (
        ${plan.planId}, ${plan.generation.generationId}, ${operatorId}, ${plan.interactionId},
        ${plan.contractHash}, ${plan.phase}, ${plan.generatedForAgentId}, ${plan.targetAgentId},
        ${JSON.stringify(plan)}::jsonb, ${plan.expiresAt}
      )
      ON CONFLICT (plan_id) DO NOTHING
      RETURNING payload
    `;
    if (!rows.length) throw new Error('Assurance probe plan already exists');
    return AssuranceProbePlanSchema.parse(rows[0]!.payload);
  }

  async saveAssuranceDecision(
    operatorId: string,
    decisionValue: AssuranceDecision,
    planValue: AssuranceProbePlan,
  ) {
    const decision = AssuranceDecisionSchema.parse(decisionValue);
    const plan = AssuranceProbePlanSchema.parse(planValue);
    if (
      decision.assessmentId !== plan.assessmentId ||
      decision.prediction.predictionId !== plan.predictionBeforeId ||
      decision.generation.generationId !== plan.generation.generationId
    )
      throw new Error('Assurance decision and probe plan are not linked');
    await this.interactionParticipant(
      operatorId,
      decision.interactionId,
      decision.generatedForAgentId,
    );
    await this.sql`
      INSERT INTO openclasp_assurance_assessments(
        assessment_id, generation_id, operator_id, interaction_id, phase, round,
        target_agent_id, target_agent_version, payload
      ) VALUES (
        ${decision.assessmentId}, ${decision.generation.generationId}, ${operatorId},
        ${decision.interactionId}, ${decision.phase}, ${decision.round}, ${decision.targetAgentId},
        ${decision.targetAgentVersion}, ${JSON.stringify(decision)}::jsonb
      )
    `;
    await this.sql`
      INSERT INTO openclasp_assurance_predictions(
        prediction_id, assessment_id, operator_id, interaction_id, target_agent_id,
        target_agent_version, task_category, stage, success_probability, payload
      ) VALUES (
        ${decision.prediction.predictionId}, ${decision.assessmentId}, ${operatorId},
        ${decision.interactionId}, ${decision.targetAgentId}, ${decision.targetAgentVersion},
        ${decision.prediction.taskCategory}, ${decision.prediction.stage},
        ${decision.prediction.successProbability}, ${JSON.stringify(decision.prediction)}::jsonb
      )
    `;
    for (const safeguard of decision.safeguards) {
      await this.sql`
        INSERT INTO openclasp_assurance_safeguards(
          safeguard_id, assessment_id, operator_id, interaction_id, target_agent_id, status, payload
        ) VALUES (
          ${safeguard.safeguardId}, ${decision.assessmentId}, ${operatorId},
          ${decision.interactionId}, ${decision.targetAgentId}, ${safeguard.status},
          ${JSON.stringify(safeguard)}::jsonb
        )
      `;
    }
    const savedPlan = await this.saveAssuranceProbePlan(operatorId, plan);
    return { decision, plan: savedPlan };
  }

  async listAssuranceProbePlans(operatorId: string, interactionId: string, agentId: string) {
    await this.interactionParticipant(operatorId, interactionId, agentId);
    const rows = await this.sql`
      SELECT payload FROM openclasp_assurance_probe_plans
      WHERE interaction_id = ${interactionId}
        AND (generated_for_agent_id = ${agentId} OR target_agent_id = ${agentId})
      ORDER BY created_at DESC
    `;
    return rows.map((row) => AssuranceProbePlanSchema.parse(row.payload));
  }

  async getAssuranceBrief(operatorId: string, interactionId: string, agentId: string) {
    await this.interactionParticipant(operatorId, interactionId, agentId);
    const [assessments, predictions, safeguards, evaluations, plans, responses] = await Promise.all(
      [
        this
          .sql`SELECT payload FROM openclasp_assurance_assessments WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId} ORDER BY created_at ASC`,
        this
          .sql`SELECT payload FROM openclasp_assurance_predictions WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId} ORDER BY created_at ASC`,
        this
          .sql`SELECT payload FROM openclasp_assurance_safeguards WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId} ORDER BY created_at ASC`,
        this
          .sql`SELECT payload FROM openclasp_assurance_evaluations WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId} ORDER BY created_at ASC`,
        this
          .sql`SELECT payload FROM openclasp_assurance_probe_plans WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId} ORDER BY created_at ASC`,
        this
          .sql`SELECT responses.payload FROM openclasp_assurance_probe_responses responses INNER JOIN openclasp_assurance_probe_plans plans ON plans.plan_id = responses.plan_id WHERE plans.operator_id = ${operatorId} AND responses.interaction_id = ${interactionId} ORDER BY responses.created_at ASC`,
      ],
    );
    const parsedAssessments = assessments.map((row) => AssuranceDecisionSchema.parse(row.payload));
    const latestAssessment = parsedAssessments.at(-1);
    const assuranceLearning = latestAssessment
      ? await this.getAssuranceLearning(
          operatorId,
          latestAssessment.targetAgentId,
          latestAssessment.targetAgentVersion,
          latestAssessment.prediction.taskCategory,
        )
      : summarizeAssuranceLearning([]);
    return {
      assessments: parsedAssessments,
      predictions: predictions.map((row) => AssurancePredictionSnapshotSchema.parse(row.payload)),
      safeguards: safeguards.map((row) => AssuranceSafeguardSchema.parse(row.payload)),
      evaluations: evaluations.map((row) =>
        AssuranceEffectivenessEvaluationSchema.parse(row.payload),
      ),
      plans: plans.map((row) => AssuranceProbePlanSchema.parse(row.payload)),
      responses: responses.map((row) => AssuranceProbeResponseSchema.parse(row.payload)),
      assuranceLearning,
      advisoryNotice: 'experimental_estimate_not_a_guarantee' as const,
    };
  }

  private async predictionAfterProbe(
    operatorId: string,
    plan: AssuranceProbePlan,
    response: AssuranceProbeResponse,
  ) {
    const rows = await this.sql`
      SELECT payload FROM openclasp_assurance_predictions
      WHERE operator_id = ${operatorId} AND interaction_id = ${plan.interactionId}
        AND target_agent_id = ${plan.targetAgentId}
      ORDER BY created_at DESC LIMIT 1
    `;
    const prior = AssurancePredictionSnapshotSchema.safeParse(rows[0]?.payload);
    if (!prior.success) return undefined;
    const question = plan.questions[0];
    const answer = response.answers.find((candidate) => candidate.probeId === question?.probeId);
    if (!question || !answer) return undefined;
    const normalized = String(answer.answer).trim().toLowerCase();
    const signal = question.expectedSignals.find(
      (candidate) => candidate.answer.trim().toLowerCase() === normalized,
    );
    const delta = signal?.probabilityDelta ?? 0;
    const prediction = AssurancePredictionSnapshotSchema.parse({
      ...prior.data,
      predictionId: crypto.randomUUID(),
      stage: 'after_probe',
      successProbability: Math.max(0.05, Math.min(0.95, prior.data.successProbability + delta)),
      confidence: Math.min(0.9, prior.data.confidence + 0.05 * answer.confidence),
      priorPredictionId: prior.data.predictionId,
      triggerResponseId: response.responseId,
      createdAt: new Date().toISOString(),
    });
    await this.sql`
      INSERT INTO openclasp_assurance_predictions(
        prediction_id, assessment_id, operator_id, interaction_id, target_agent_id,
        target_agent_version, task_category, stage, success_probability, payload
      ) VALUES (
        ${prediction.predictionId}, ${plan.assessmentId}, ${operatorId}, ${prediction.interactionId},
        ${prediction.targetAgentId}, ${prediction.targetAgentVersion}, ${prediction.taskCategory},
        ${prediction.stage}, ${prediction.successProbability}, ${JSON.stringify(prediction)}::jsonb
      )
    `;
    return prediction;
  }

  async decideAssuranceSafeguard(
    operatorId: string,
    interactionId: string,
    agentId: string,
    safeguardId: string,
    status: 'accepted' | 'rejected' | 'modified',
    decisionReason?: string,
  ) {
    await this.interactionParticipant(operatorId, interactionId, agentId);
    const rows = await this.sql`
      SELECT safeguard.payload, safeguard.assessment_id, assessment.payload AS assessment
      FROM openclasp_assurance_safeguards safeguard
      INNER JOIN openclasp_assurance_assessments assessment
        ON assessment.assessment_id = safeguard.assessment_id
      WHERE safeguard.operator_id = ${operatorId} AND safeguard.interaction_id = ${interactionId}
        AND safeguard.safeguard_id = ${safeguardId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error('Assurance safeguard not found');
    const assessment = AssuranceDecisionSchema.parse(row.assessment);
    if (assessment.generatedForAgentId !== agentId)
      throw new Error('Only the agent that requested the assessment may decide its safeguard');
    const current = AssuranceSafeguardSchema.parse(row.payload);
    if (current.status !== 'recommended')
      throw new Error('Assurance safeguard was already decided');
    const safeguard = AssuranceSafeguardSchema.parse({
      ...current,
      status,
      ...(decisionReason ? { decisionReason } : {}),
      decidedAt: new Date().toISOString(),
    });
    await this.sql`
      UPDATE openclasp_assurance_safeguards
      SET status = ${status}, payload = ${JSON.stringify(safeguard)}::jsonb, updated_at = NOW()
      WHERE safeguard_id = ${safeguardId} AND operator_id = ${operatorId}
    `;
    let prediction: AssurancePredictionSnapshot | undefined;
    if (status !== 'rejected') {
      const priorRows = await this.sql`
        SELECT payload FROM openclasp_assurance_predictions
        WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId}
          AND target_agent_id = ${safeguard.targetAgentId}
        ORDER BY created_at DESC LIMIT 1
      `;
      const prior = AssurancePredictionSnapshotSchema.safeParse(priorRows[0]?.payload);
      if (prior.success) {
        prediction = AssurancePredictionSnapshotSchema.parse({
          ...prior.data,
          predictionId: crypto.randomUUID(),
          stage: 'after_safeguard',
          successProbability: Math.min(
            0.95,
            prior.data.successProbability + Math.min(0.15, safeguard.expectedImpact),
          ),
          confidence: Math.min(0.9, prior.data.confidence + 0.03),
          priorPredictionId: prior.data.predictionId,
          createdAt: new Date().toISOString(),
        });
        await this.sql`
          INSERT INTO openclasp_assurance_predictions(
            prediction_id, assessment_id, operator_id, interaction_id, target_agent_id,
            target_agent_version, task_category, stage, success_probability, payload
          ) VALUES (
            ${prediction.predictionId}, ${String(row.assessment_id)}, ${operatorId},
            ${prediction.interactionId}, ${prediction.targetAgentId}, ${prediction.targetAgentVersion},
            ${prediction.taskCategory}, ${prediction.stage}, ${prediction.successProbability},
            ${JSON.stringify(prediction)}::jsonb
          )
        `;
      }
    }
    return { safeguard, prediction, contractRevisionRequired: status !== 'rejected' };
  }

  private async recalculateAssuranceComparison(
    operatorId: string,
    interactionId: string,
    targetAgentId: string,
  ): Promise<AssuranceClaimOutcomeComparison | undefined> {
    const responseRows = await this.sql`
      SELECT responses.response_id, responses.phase, responses.payload
      FROM openclasp_assurance_probe_responses responses
      INNER JOIN openclasp_assurance_probe_plans plans ON plans.plan_id = responses.plan_id
      WHERE responses.interaction_id = ${interactionId}
        AND responses.agent_id = ${targetAgentId}
        AND plans.operator_id = ${operatorId}
      ORDER BY responses.created_at DESC
    `;
    const preRow = responseRows.find((row) => row.phase === 'pre_task');
    if (!preRow) return undefined;
    const pre = AssuranceProbeResponseSchema.parse(preRow.payload);
    const postRow = responseRows.find((row) => row.phase === 'post_task');
    const post = postRow ? AssuranceProbeResponseSchema.parse(postRow.payload) : undefined;
    const reportRows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'completion_report'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'reportingAgentId' = ${targetAgentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const report = InteractionCompletionReportSchema.safeParse(reportRows[0]?.payload);
    if (!report.success) return undefined;
    const comparison = AssuranceClaimOutcomeComparisonSchema.parse({
      protocolVersion: '0.1',
      comparisonId: deterministicUuid(`assurance-comparison:${operatorId}:${pre.responseId}`),
      interactionId,
      contractHash: pre.contractHash,
      targetAgentId,
      preTaskResponseId: pre.responseId,
      ...(post ? { postTaskResponseId: post.responseId } : {}),
      completionReportIds: [report.data.reportId],
      comparisons: pre.answers.map((answer) => assuranceClaimComparison(answer, report.data)),
      calculatedAt: new Date().toISOString(),
    });
    await this.sql`
      INSERT INTO openclasp_assurance_claim_comparisons(
        comparison_id, operator_id, interaction_id, target_agent_id,
        pre_task_response_id, post_task_response_id, payload
      ) VALUES (
        ${comparison.comparisonId}, ${operatorId}, ${interactionId}, ${targetAgentId},
        ${comparison.preTaskResponseId}, ${comparison.postTaskResponseId ?? null},
        ${JSON.stringify(comparison)}::jsonb
      )
      ON CONFLICT (operator_id, interaction_id, target_agent_id, pre_task_response_id)
      DO UPDATE SET post_task_response_id = EXCLUDED.post_task_response_id,
        payload = EXCLUDED.payload, created_at = NOW()
    `;
    return comparison;
  }

  async submitAssuranceProbeResponse(
    operatorId: string,
    agentId: string,
    value: AssuranceProbeResponse,
  ) {
    const response = AssuranceProbeResponseSchema.parse(value);
    const participant = await this.interactionParticipant(
      operatorId,
      response.interactionId,
      agentId,
    );
    if (response.agentId !== agentId)
      throw new Error('Assurance response identity does not match the authenticated agent');
    if (participant.interaction.termsHash !== response.contractHash)
      throw new Error('Assurance response contract hash is stale');
    const planRows = await this.sql`
      SELECT operator_id, target_agent_id, phase, payload, expires_at
      FROM openclasp_assurance_probe_plans
      WHERE plan_id = ${response.planId} AND interaction_id = ${response.interactionId}
      LIMIT 1
    `;
    const row = planRows[0];
    if (!row) throw new Error('Assurance probe plan not found');
    const plan = AssuranceProbePlanSchema.parse(row.payload);
    if (row.target_agent_id !== agentId || response.phase !== row.phase)
      throw new Error('Assurance response does not match the targeted probe plan');
    if (response.agentVersion !== plan.targetAgentVersion)
      throw new Error('Assurance response agent version does not match the probe plan');
    if (Date.parse(String(row.expires_at)) <= Date.now())
      throw new Error('Assurance probe plan expired');
    const answerIds = new Set(response.answers.map((answer) => answer.probeId));
    for (const question of plan.questions) {
      const answer = response.answers.find((candidate) => candidate.probeId === question.probeId);
      if (question.required && !answer)
        throw new Error(`Required assurance probe ${question.questionCode} is unanswered`);
      if (!answer) continue;
      if (
        answer.questionCode !== question.questionCode ||
        answer.responseType !== question.responseType ||
        (question.responseType === 'enum' && !question.choices?.includes(String(answer.answer)))
      )
        throw new Error(`Assurance answer does not match probe ${question.questionCode}`);
    }
    if (
      answerIds.size !== response.answers.length ||
      response.answers.some(
        (answer) => !plan.questions.some((question) => question.probeId === answer.probeId),
      )
    )
      throw new Error('Assurance response contains duplicate or unknown probes');
    const rows = await this.sql`
      INSERT INTO openclasp_assurance_probe_responses(
        response_id, plan_id, operator_id, interaction_id, contract_hash, phase, agent_id, payload
      ) VALUES (
        ${response.responseId}, ${response.planId}, ${operatorId}, ${response.interactionId},
        ${response.contractHash}, ${response.phase}, ${agentId}, ${JSON.stringify(response)}::jsonb
      )
      ON CONFLICT (plan_id, agent_id) DO NOTHING
      RETURNING payload
    `;
    if (!rows.length) throw new Error('This agent already answered the assurance probe plan');
    const storedResponse = AssuranceProbeResponseSchema.parse(rows[0]!.payload);
    const prediction = await this.predictionAfterProbe(
      String(row.operator_id),
      plan,
      storedResponse,
    );
    const comparison = await this.recalculateAssuranceComparison(
      String(row.operator_id),
      response.interactionId,
      agentId,
    );
    return { response: storedResponse, prediction, comparison };
  }

  async recordSessionAssuranceResponse(token: string, value: AssuranceProbeResponse) {
    const response = AssuranceProbeResponseSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (grant.interactionId !== response.interactionId || grant.senderAgentId !== response.agentId)
      throw new Error('Session credential does not match the assurance response');
    const owners = await this.sql`
      SELECT initiator_operator_id, responder_operator_id, initiator_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${response.interactionId}
      LIMIT 1
    `;
    const row = owners[0];
    if (!row) throw new Error('Interaction not found');
    const operatorId = String(
      row.initiator_agent_id === response.agentId
        ? row.initiator_operator_id
        : row.responder_operator_id,
    );
    return this.submitAssuranceProbeResponse(operatorId, response.agentId, response);
  }

  async listAssuranceComparisons(operatorId: string, interactionId: string, agentId: string) {
    await this.interactionParticipant(operatorId, interactionId, agentId);
    const rows = await this.sql`
      SELECT payload FROM openclasp_assurance_claim_comparisons
      WHERE operator_id = ${operatorId} AND interaction_id = ${interactionId}
      ORDER BY created_at DESC
    `;
    return rows.map((row) => AssuranceClaimOutcomeComparisonSchema.parse(row.payload));
  }

  private async evaluateAssuranceOutcome(
    operatorId: string,
    report: InteractionCompletionReport,
  ): Promise<AssuranceEffectivenessEvaluation | undefined> {
    const [predictionRows, planRows, responseRows, safeguardRows] = await Promise.all([
      this
        .sql`SELECT payload FROM openclasp_assurance_predictions WHERE operator_id = ${operatorId} AND interaction_id = ${report.interactionId} AND target_agent_id = ${report.reportingAgentId} ORDER BY created_at ASC`,
      this
        .sql`SELECT payload FROM openclasp_assurance_probe_plans WHERE operator_id = ${operatorId} AND interaction_id = ${report.interactionId} AND target_agent_id = ${report.reportingAgentId} ORDER BY created_at ASC`,
      this
        .sql`SELECT responses.payload FROM openclasp_assurance_probe_responses responses INNER JOIN openclasp_assurance_probe_plans plans ON plans.plan_id = responses.plan_id WHERE plans.operator_id = ${operatorId} AND responses.interaction_id = ${report.interactionId} AND responses.agent_id = ${report.reportingAgentId} ORDER BY responses.created_at ASC`,
      this
        .sql`SELECT payload FROM openclasp_assurance_safeguards WHERE operator_id = ${operatorId} AND interaction_id = ${report.interactionId} AND target_agent_id = ${report.reportingAgentId} ORDER BY created_at ASC`,
    ]);
    if (!predictionRows.length && !planRows.length) return undefined;
    const predictions = predictionRows.map((row) =>
      AssurancePredictionSnapshotSchema.parse(row.payload),
    );
    const plans = planRows.map((row) => AssuranceProbePlanSchema.parse(row.payload));
    const responses = responseRows.map((row) => AssuranceProbeResponseSchema.parse(row.payload));
    const safeguards = safeguardRows.map((row) => AssuranceSafeguardSchema.parse(row.payload));
    const outcomeValue = report.outcome === 'success' ? 1 : report.outcome === 'partial' ? 0.5 : 0;
    const evaluation = AssuranceEffectivenessEvaluationSchema.parse({
      protocolVersion: '0.1',
      evaluationId: deterministicUuid(`assurance-evaluation:${operatorId}:${report.reportId}`),
      interactionId: report.interactionId,
      contractHash: report.contractHash,
      targetAgentId: report.reportingAgentId,
      targetAgentVersion: report.agentVersion,
      taskCategory: predictions[0]?.taskCategory ?? 'general',
      completionReportId: report.reportId,
      outcomeValue,
      predictionScores: predictions.map((prediction) => ({
        predictionId: prediction.predictionId,
        stage: prediction.stage,
        probability: prediction.successProbability,
        brierScore: (prediction.successProbability - outcomeValue) ** 2,
      })),
      questionScores: plans.flatMap((plan) =>
        plan.questions.map((question) => {
          const response = responses.find((candidate) => candidate.planId === plan.planId);
          const answer = response?.answers.find(
            (candidate) => candidate.probeId === question.probeId,
          );
          const signal = answer
            ? question.expectedSignals.find(
                (candidate) =>
                  candidate.answer.toLowerCase() === String(answer.answer).toLowerCase(),
              )
            : undefined;
          const before = predictions.find(
            (prediction) => prediction.predictionId === plan.predictionBeforeId,
          );
          const after = response
            ? predictions.find((prediction) => prediction.triggerResponseId === response.responseId)
            : undefined;
          return {
            probeId: question.probeId,
            questionCode: question.questionCode,
            questionFamily: question.questionFamily,
            answered: Boolean(answer),
            exposedMaterialRisk:
              signal?.effect === 'reduce_success' ||
              Boolean(answer?.limitations.length) ||
              report.blockers.length > 0,
            predictionDelta:
              before && after ? after.successProbability - before.successProbability : 0,
          };
        }),
      ),
      safeguardScores: safeguards.map((safeguard) => ({
        safeguardId: safeguard.safeguardId,
        type: safeguard.type,
        status: safeguard.status,
        outcomeAssociation:
          safeguard.status === 'accepted' || safeguard.status === 'modified'
            ? outcomeValue >= 0.75
              ? 'positive'
              : outcomeValue <= 0.25
                ? 'negative'
                : 'unclear'
            : 'unclear',
        causalClaim: false,
      })),
      evaluatedAt: new Date().toISOString(),
    });
    await this.sql`
      INSERT INTO openclasp_assurance_evaluations(
        evaluation_id, operator_id, interaction_id, target_agent_id, target_agent_version,
        task_category, completion_report_id, payload
      ) VALUES (
        ${evaluation.evaluationId}, ${operatorId}, ${evaluation.interactionId},
        ${evaluation.targetAgentId}, ${evaluation.targetAgentVersion}, ${evaluation.taskCategory},
        ${evaluation.completionReportId}, ${JSON.stringify(evaluation)}::jsonb
      )
      ON CONFLICT (operator_id, completion_report_id)
      DO UPDATE SET payload = EXCLUDED.payload, created_at = NOW()
    `;
    return evaluation;
  }

  private async ensureFeedbackRequest(
    operatorId: string,
    interactionId: string,
    reviewerAgentId: string,
    subjectAgentId: string,
  ) {
    const existing = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND payload->>'interactionId' = ${interactionId}
        AND payload->>'reviewerAgentId' = ${reviewerAgentId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const parsed = FeedbackRequestSchema.safeParse(existing[0]?.payload);
    if (parsed.success) return parsed.data;
    const requestedAt = new Date();
    const base = FeedbackRequestSchema.parse({
      requestId: deterministicUuid(`feedback-request:${interactionId}:${reviewerAgentId}`),
      interactionId,
      reviewerAgentId,
      subjectAgentId,
      status: 'pending',
      requestedDimensions: FEEDBACK_DIMENSIONS,
      requestedAt: requestedAt.toISOString(),
      dueAt: new Date(requestedAt.getTime() + feedbackWindowMilliseconds()).toISOString(),
    });
    const request = FeedbackRequestSchema.parse({
      ...base,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), base),
    });
    await this.upsert(operatorId, 'feedback_request', request.requestId, request);
    return request;
  }

  private async requestRuntimeFinalization(
    interactionId: string,
    reportingAgentId: string,
    counterpartyAgentId: string,
    contractHash: string,
  ) {
    const rows = await this.sql`
      SELECT endpoint FROM openclasp_agent_runtimes
      WHERE agent_id = ${counterpartyAgentId} AND status = 'verified'
      LIMIT 1
    `;
    if (!rows[0]?.endpoint) return false;
    const requestId = crypto.randomUUID();
    const value = {
      type: 'openclasp.session.finalization_request',
      version: '1',
      requestId,
      interactionId,
      agentId: counterpartyAgentId,
      peerAgentId: reportingAgentId,
      contractHash,
      requestedAt: new Date().toISOString(),
    };
    const response = await this.signedRuntimeRequest(
      { callbackEndpoint: String(rows[0].endpoint) },
      requestId,
      value,
    );
    return response.status >= 200 && response.status < 300;
  }

  async listFeedbackRequests(operatorId: string, agentId: string) {
    const rows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND payload->>'reviewerAgentId' = ${agentId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => FeedbackRequestSchema.parse(row.payload));
  }

  async submitCompletionReport(
    operatorId: string,
    agentId: string,
    value: InteractionCompletionReport,
    submissionMethod:
      'oauth_account' | 'oauth_installation' | 'agent_access_token' | 'runtime_session',
  ) {
    const participant = await this.interactionParticipant(operatorId, value.interactionId, agentId);
    const report = InteractionCompletionReportSchema.parse(value);
    if (report.platformAttestation)
      throw new Error('Platform attestation is assigned by OpenClasp');
    if (report.reportingAgentId !== agentId)
      throw new Error('Completion report identity does not match the authenticated agent');
    if (report.counterpartyAgentId !== participant.counterpartyAgentId)
      throw new Error('Completion report counterparty does not match the interaction');
    if (report.contractHash !== participant.interaction.termsHash)
      throw new Error('Completion report contract hash does not match the interaction');
    if (report.requestedOutcome !== participant.interaction.contract.requestedOutcome)
      throw new Error('Completion report requested outcome does not match the contract');
    if (
      report.criteria.some(
        (criterion) =>
          !participant.interaction.contract.successCriteria.includes(criterion.criterion),
      )
    )
      throw new Error('Completion report contains a criterion outside the contract');
    if (!['active', 'completed'].includes(participant.interaction.status))
      throw new Error('Only active or completed interactions accept completion reports');
    const profiles = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const profile = profiles[0]?.payload as Partial<AgentProfile> | undefined;
    if (!profile || profile.agentVersion !== report.agentVersion)
      throw new Error('Completion report agent version does not match the registered agent');
    let verifiedSubmissionMethod: InteractionCompletionReport['submissionMethod'] =
      submissionMethod;
    if (report.signature) {
      if (report.submissionMethod !== 'agent_signature')
        throw new Error('Signed completion reports must declare agent_signature submission');
      const identities = await this.sql`
        SELECT payload FROM openclasp_records
        WHERE operator_id = ${operatorId} AND kind = 'agent' AND record_id = ${agentId}
        LIMIT 1
      `;
      const identity = AgentIdentitySchema.safeParse(identities[0]?.payload);
      if (
        !identity.success ||
        !verifyObject(report as unknown as Record<string, unknown>, identity.data.publicKey)
      )
        throw new Error('Completion report agent signature is invalid or unverifiable');
      verifiedSubmissionMethod = 'agent_signature';
    }
    const unsigned = InteractionCompletionReportSchema.parse({
      ...report,
      submissionMethod: verifiedSubmissionMethod,
    });
    const stored = InteractionCompletionReportSchema.parse({
      ...unsigned,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), unsigned),
    });
    const existing = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE kind = 'completion_report' AND record_id = ${stored.reportId}
        AND payload->>'interactionId' = ${stored.interactionId}
      LIMIT 1
    `;
    if (existing[0] && canonicalHash(existing[0].payload) !== canonicalHash(stored))
      throw new Error('Conflicting completion report ID');
    await Promise.all([
      this.upsert(participant.participantOperatorId, 'completion_report', stored.reportId, stored),
      this.upsert(participant.counterpartyOperatorId, 'completion_report', stored.reportId, stored),
    ]);
    const assuranceComparisons = (
      await Promise.all([
        this.recalculateAssuranceComparison(
          participant.participantOperatorId,
          stored.interactionId,
          stored.reportingAgentId,
        ).catch(() => undefined),
        this.recalculateAssuranceComparison(
          participant.counterpartyOperatorId,
          stored.interactionId,
          stored.reportingAgentId,
        ).catch(() => undefined),
      ])
    ).filter((comparison) => comparison !== undefined);
    const assuranceEvaluations = (
      await Promise.all([
        this.evaluateAssuranceOutcome(participant.participantOperatorId, stored).catch(
          () => undefined,
        ),
        this.evaluateAssuranceOutcome(participant.counterpartyOperatorId, stored).catch(
          () => undefined,
        ),
      ])
    ).filter((evaluation) => evaluation !== undefined);
    const [feedbackRequest] = await Promise.all([
      this.ensureFeedbackRequest(
        participant.participantOperatorId,
        stored.interactionId,
        stored.reportingAgentId,
        stored.counterpartyAgentId,
      ),
      this.ensureFeedbackRequest(
        participant.counterpartyOperatorId,
        stored.interactionId,
        stored.counterpartyAgentId,
        stored.reportingAgentId,
      ),
    ]);
    const completed = await this.sql`
      SELECT COUNT(DISTINCT payload->>'reportingAgentId') AS count
      FROM openclasp_records
      WHERE kind = 'completion_report'
        AND payload->>'interactionId' = ${stored.interactionId}
    `;
    let peerReportStatus: InteractionConclusion['peerReportStatus'] = 'received';
    if (Number(completed[0]?.count ?? 0) >= 2) {
      const completedAt = new Date().toISOString();
      await Promise.all([
        this.sql`
          UPDATE openclasp_live_sessions SET status = 'completed', completed_at = NOW()
          WHERE interaction_id = ${stored.interactionId} AND status = 'active'
        `,
        this.sql`
          UPDATE openclasp_federated_interactions
          SET status = 'completed',
            payload = jsonb_set(
              jsonb_set(payload, '{status}', '"completed"'::jsonb),
              '{updatedAt}', to_jsonb(${completedAt}::text)
            ),
            updated_at = NOW()
          WHERE interaction_id = ${stored.interactionId} AND status = 'active'
        `,
      ]);
      await Promise.all([
        this.journalLiveSessionState(stored.interactionId),
        this.journalFederatedInteraction(stored.interactionId),
      ]);
    } else {
      const requested = await this.requestRuntimeFinalization(
        stored.interactionId,
        stored.reportingAgentId,
        stored.counterpartyAgentId,
        stored.contractHash,
      ).catch(() => false);
      peerReportStatus = requested ? 'awaiting' : 'unreachable';
    }
    const conclusion = await this.finalizeInteractionConclusion(stored.interactionId, {
      peerReportStatus,
    });
    return {
      report: stored,
      feedbackRequest,
      peerReportRequested: peerReportStatus === 'awaiting',
      assuranceComparisons,
      assuranceEvaluations,
      ...(conclusion.released ? { conclusion: conclusion.conclusion } : {}),
    };
  }

  async recordSessionCompletionReport(token: string, value: InteractionCompletionReport) {
    const report = InteractionCompletionReportSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (
      grant.interactionId !== report.interactionId ||
      grant.senderAgentId !== report.reportingAgentId ||
      grant.recipientAgentId !== report.counterpartyAgentId
    )
      throw new Error('Session credential does not match the completion report');
    const owners = await this.sql`
      SELECT initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${report.interactionId}
      LIMIT 1
    `;
    const row = owners[0];
    if (!row) throw new Error('Interaction not found');
    const operatorId = String(
      row.initiator_agent_id === report.reportingAgentId
        ? row.initiator_operator_id
        : row.responder_operator_id,
    );
    return this.submitCompletionReport(
      operatorId,
      report.reportingAgentId,
      report,
      'runtime_session',
    );
  }

  private async applyInteractionLearning(input: {
    interaction: FederatedInteraction;
    initiatorOperatorId: string;
    responderOperatorId: string;
    reports: InteractionCompletionReport[];
    feedback: InteractionFeedback[];
    conclusion: InteractionConclusion;
  }) {
    const { interaction, reports, feedback, conclusion } = input;
    const [initiatorSettings, responderSettings, cards, pairActivity] = await Promise.all([
      this.getSettings(input.initiatorOperatorId),
      this.getSettings(input.responderOperatorId),
      this.sql`
        SELECT agent_id, card FROM openclasp_public_agents
        WHERE agent_id IN (${interaction.initiatorAgentId}, ${interaction.responderAgentId})
      `,
      this.sql`
        SELECT COUNT(*)::integer AS count
        FROM openclasp_federated_interactions
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND (
            (initiator_agent_id = ${interaction.initiatorAgentId}
              AND responder_agent_id = ${interaction.responderAgentId})
            OR
            (initiator_agent_id = ${interaction.responderAgentId}
              AND responder_agent_id = ${interaction.initiatorAgentId})
          )
      `,
    ]);
    const contributionMode =
      initiatorSettings.contributionEnabled && responderSettings.contributionEnabled
        ? ('network_aggregate' as const)
        : ('local_only' as const);
    const eligibilityBase = evaluateLearningEligibility({
      interactionId: interaction.interactionId,
      reports,
      feedback,
      consensus: conclusion.consensus,
      contributionMode,
      reviewerCredibility: Object.fromEntries(
        feedback.map((item) => [item.reviewerAgentId, reviewerCredibility(item)]),
      ),
      manipulationSignals: [
        ...(input.initiatorOperatorId === input.responderOperatorId ? ['same_operator_pair'] : []),
        ...(Number(pairActivity[0]?.count ?? 0) > 10 ? ['rapid_reciprocal_pair_activity'] : []),
      ],
      decisionId: deterministicUuid(`learning-eligibility:${interaction.interactionId}`),
      decidedAt: conclusion.generatedAt,
    });
    const eligibility = LearningEligibilityDecisionSchema.parse({
      ...eligibilityBase,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), eligibilityBase),
    });
    await Promise.all([
      this.upsert(
        input.initiatorOperatorId,
        'learning_eligibility',
        eligibility.decisionId,
        eligibility,
      ),
      this.upsert(
        input.responderOperatorId,
        'learning_eligibility',
        eligibility.decisionId,
        eligibility,
      ),
    ]);
    if (!eligibility.eligible || eligibility.sampleWeight <= 0)
      return { eligibility, profileDeltas: [] as BehaviouralProfileDelta[] };

    const appliedAt = new Date().toISOString();
    const versions = new Map<string, string>();
    for (const report of reports) versions.set(report.reportingAgentId, report.agentVersion);
    for (const row of cards) {
      const card = PublicAgentCardSchema.safeParse(row.card);
      if (card.success && !versions.has(String(row.agent_id)))
        versions.set(String(row.agent_id), card.data.agentVersion);
    }
    const participants = [
      {
        viewerOperatorId: input.initiatorOperatorId,
        reviewerAgentId: interaction.initiatorAgentId,
        subjectAgentId: interaction.responderAgentId,
      },
      {
        viewerOperatorId: input.responderOperatorId,
        reviewerAgentId: interaction.responderAgentId,
        subjectAgentId: interaction.initiatorAgentId,
      },
      {
        viewerOperatorId: input.initiatorOperatorId,
        reviewerAgentId: interaction.responderAgentId,
        subjectAgentId: interaction.initiatorAgentId,
      },
      {
        viewerOperatorId: input.responderOperatorId,
        reviewerAgentId: interaction.initiatorAgentId,
        subjectAgentId: interaction.responderAgentId,
      },
    ];
    const profileDeltas: Array<BehaviouralProfileDelta | undefined> = [];
    for (const participant of participants) {
      const agentVersion = versions.get(participant.subjectAgentId);
      if (!agentVersion) {
        profileDeltas.push(undefined);
        continue;
      }
      const deltaId = deterministicUuid(
        `profile-delta:${interaction.interactionId}:${participant.viewerOperatorId}:${participant.reviewerAgentId}:${participant.subjectAgentId}`,
      );
      const legacyDeltaId = deterministicUuid(
        `profile-delta:${interaction.interactionId}:${participant.viewerOperatorId}:${participant.subjectAgentId}`,
      );
      const existingDelta = await this.sql`
          SELECT payload FROM openclasp_records
          WHERE operator_id = ${participant.viewerOperatorId}
            AND kind = 'profile_delta'
            AND (record_id = ${deltaId} OR record_id = ${legacyDeltaId})
          LIMIT 1
        `;
      const parsedDelta = BehaviouralProfileDeltaSchema.safeParse(existingDelta[0]?.payload);
      if (parsedDelta.success) {
        profileDeltas.push(parsedDelta.data);
        continue;
      }
      const profileId = deterministicUuid(
        `contextual-profile:${participant.subjectAgentId}:${agentVersion}:${interaction.contract.taskCategory}`,
      );
      const currentRows = await this.sql`
          SELECT payload FROM openclasp_records
          WHERE operator_id = ${participant.viewerOperatorId}
            AND kind = 'profile' AND record_id = ${profileId}
          LIMIT 1
        `;
      const current = currentRows[0]?.payload as Partial<ContextualProfile> | undefined;
      const reviewerFeedback = feedback.find(
        (item) =>
          item.reviewerAgentId === participant.reviewerAgentId &&
          item.subjectAgentId === participant.subjectAgentId,
      );
      const observations = deriveBehaviouralObservations({
        subjectAgentId: participant.subjectAgentId,
        reviewerAgentId: participant.reviewerAgentId,
        reports,
        ...(reviewerFeedback ? { reviewerFeedback } : {}),
        conclusion,
      });
      if (!Object.keys(observations).length) {
        profileDeltas.push(undefined);
        continue;
      }
      const applied = updateContextualBehaviouralProfile({
        ...(current ? { current } : {}),
        observations,
        sampleWeight: eligibility.sampleWeight,
        appliedAt,
      });
      const profile: ContextualProfile = {
        recordId: profileId,
        agentId: participant.subjectAgentId,
        agentVersion,
        taskCategory: interaction.contract.taskCategory,
        ...applied.profile,
      };
      const deltaBase = BehaviouralProfileDeltaSchema.parse({
        deltaId,
        interactionId: interaction.interactionId,
        agentId: participant.subjectAgentId,
        agentVersion,
        taskCategory: interaction.contract.taskCategory,
        sampleWeight: eligibility.sampleWeight,
        dimensionDeltas: applied.dimensionDeltas,
        explanation:
          'Applied platform-attested structured outcome and eligible reviewer signals; private comments and raw conversation content were excluded.',
        appliedAt,
      });
      const delta = BehaviouralProfileDeltaSchema.parse({
        ...deltaBase,
        platformAttestation: attestSessionRecord(this.gatewaySecret(), deltaBase),
      });
      await Promise.all([
        this.upsert(participant.viewerOperatorId, 'profile', profileId, profile),
        this.upsert(participant.viewerOperatorId, 'profile_delta', deltaId, delta),
      ]);
      profileDeltas.push(delta);
    }
    return {
      eligibility,
      profileDeltas: profileDeltas.filter(
        (delta): delta is BehaviouralProfileDelta => delta !== undefined,
      ),
    };
  }

  private async finalizeInteractionConclusion(
    interactionId: string,
    options: { peerReportStatus?: InteractionConclusion['peerReportStatus'] } = {},
  ) {
    const [interactionRows, reportRows, feedbackRows, requestRows, existingRows] =
      await Promise.all([
        this.sql`
        SELECT payload, initiator_operator_id, responder_operator_id
        FROM openclasp_federated_interactions
        WHERE interaction_id = ${interactionId}
        LIMIT 1
      `,
        this.sql`
        SELECT record_id, payload FROM openclasp_records
        WHERE kind = 'completion_report' AND payload->>'interactionId' = ${interactionId}
      `,
        this.sql`
        SELECT record_id, payload FROM openclasp_records
        WHERE kind = 'interaction_feedback' AND payload->>'interactionId' = ${interactionId}
      `,
        this.sql`
        SELECT record_id, payload FROM openclasp_records
        WHERE kind = 'feedback_request' AND payload->>'interactionId' = ${interactionId}
      `,
        this.sql`
        SELECT payload FROM openclasp_records
        WHERE kind = 'interaction_conclusion' AND payload->>'interactionId' = ${interactionId}
        LIMIT 1
      `,
      ]);
    const interactionRow = interactionRows[0];
    if (!interactionRow) throw new Error('Interaction not found');
    const interaction = FederatedInteractionSchema.parse(interactionRow.payload);
    const reports = [
      ...new Map(
        reportRows
          .map((row) => InteractionCompletionReportSchema.parse(row.payload))
          .map((report) => [report.reportId, report]),
      ).values(),
    ];
    const feedback = [
      ...new Map(
        feedbackRows
          .map((row) => InteractionFeedbackSchema.parse(row.payload))
          .map((item) => [item.feedbackId, item]),
      ).values(),
    ];
    const requests = [
      ...new Map(
        requestRows
          .map((row) => FeedbackRequestSchema.parse(row.payload))
          .map((request) => [request.requestId, request]),
      ).values(),
    ];
    if (!reports.length) return { released: false as const, feedbackRevealed: false as const };
    const existing = InteractionConclusionSchema.safeParse(existingRows[0]?.payload);
    const reportingAgentIds = new Set(reports.map((report) => report.reportingAgentId));
    const missingReportAgentIds = [
      interaction.initiatorAgentId,
      interaction.responderAgentId,
    ].filter((agentId) => !reportingAgentIds.has(agentId));
    const feedbackWindowClosed =
      requests.length >= 2 && requests.every((request) => request.status !== 'pending');
    const lifecycle =
      missingReportAgentIds.length === 0 || feedbackWindowClosed
        ? ('final' as const)
        : ('provisional' as const);
    const visibleFeedback = feedbackWindowClosed ? feedback : [];
    const peerReportStatus: InteractionConclusion['peerReportStatus'] =
      missingReportAgentIds.length === 0
        ? 'received'
        : feedbackWindowClosed
          ? 'timed_out'
          : (options.peerReportStatus ?? existing.data?.peerReportStatus ?? 'awaiting');
    const pendingFeedbackAgentIds = requests
      .filter((request) => request.status === 'pending')
      .map((request) => request.reviewerAgentId);
    if (requests.length < 2) return { released: false as const };
    const base = buildInteractionConclusion({
      interaction,
      reports,
      feedback: visibleFeedback,
      conclusionId: deterministicUuid(`interaction-conclusion:${interactionId}`),
      lifecycle,
      pendingFeedbackAgentIds,
      peerReportStatus,
    });
    const conclusion = InteractionConclusionSchema.parse({
      ...base,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), base),
    });
    const startedAt = reports
      .map((report) => report.startedAt)
      .filter((value): value is string => typeof value === 'string')
      .sort()[0];
    const receiptBase = {
      receiptId: deterministicUuid(`interaction-receipt:${interactionId}`),
      interactionId,
      participants: [interaction.initiatorAgentId, interaction.responderAgentId],
      agentVersions: Object.fromEntries(
        reports.map((report) => [report.reportingAgentId, report.agentVersion]),
      ),
      contractHash: interaction.termsHash,
      startedAt: startedAt ?? interaction.createdAt,
      completedAt:
        reports
          .map((report) => report.completedAt)
          .sort()
          .at(-1) ?? conclusion.generatedAt,
      outcome: conclusion.outcome,
      commitmentsFulfilled: conclusion.criteria
        .filter((criterion) => criterion.status === 'met')
        .map((criterion) => criterion.criterion),
      commitmentsMissed: conclusion.criteria
        .filter((criterion) => criterion.status !== 'met')
        .map((criterion) => criterion.criterion),
      evidenceHashes: conclusion.evidenceReferences.map((reference) => canonicalHash(reference)),
      policyWarnings: reports.flatMap((report) => report.blockers),
      policyViolations: [],
      disputeStatus: conclusion.consensus === 'conflicting' ? ('open' as const) : ('none' as const),
      delegationChainHash: canonicalHash(interaction.contract.delegationRules),
      unilateral: reports.length < 2,
      provisional: lifecycle === 'provisional',
      confidence: conclusion.confidence,
      signatures: {},
      completionReportIds: conclusion.reportIds,
      conclusionId: conclusion.conclusionId,
    };
    const receipt = ReceiptSchema.parse({
      ...receiptBase,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), receiptBase),
    });
    await Promise.all([
      this.upsert(
        String(interactionRow.initiator_operator_id),
        'interaction_conclusion',
        conclusion.conclusionId,
        conclusion,
      ),
      this.upsert(
        String(interactionRow.responder_operator_id),
        'interaction_conclusion',
        conclusion.conclusionId,
        conclusion,
      ),
      this.upsert(
        String(interactionRow.initiator_operator_id),
        'receipt',
        receipt.receiptId,
        receipt,
      ),
      this.upsert(
        String(interactionRow.responder_operator_id),
        'receipt',
        receipt.receiptId,
        receipt,
      ),
    ]);
    const learning =
      lifecycle === 'final' && feedbackWindowClosed
        ? await this.applyInteractionLearning({
            interaction,
            initiatorOperatorId: String(interactionRow.initiator_operator_id),
            responderOperatorId: String(interactionRow.responder_operator_id),
            reports,
            feedback: visibleFeedback,
            conclusion,
          })
        : undefined;
    return {
      released: true as const,
      feedbackRevealed: feedbackWindowClosed,
      conclusion,
      receipt,
      ...(learning ? { learning } : {}),
    };
  }

  async submitInteractionFeedback(
    operatorId: string,
    agentId: string,
    value: InteractionFeedback,
    submissionMethod:
      'oauth_account' | 'oauth_installation' | 'agent_access_token' | 'runtime_session',
  ) {
    const feedback = InteractionFeedbackSchema.parse(value);
    if (feedback.platformAttestation)
      throw new Error('Platform attestation is assigned by OpenClasp');
    if (feedback.reviewerAgentId !== agentId)
      throw new Error('Feedback reviewer does not match the authenticated agent');
    const participant = await this.interactionParticipant(
      operatorId,
      feedback.interactionId,
      agentId,
    );
    if (feedback.subjectAgentId !== participant.counterpartyAgentId)
      throw new Error('Feedback subject does not match the interaction counterparty');
    const requestRows = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'feedback_request'
        AND record_id = ${feedback.requestId}
      LIMIT 1
    `;
    const request = FeedbackRequestSchema.parse(requestRows[0]?.payload);
    if (
      request.interactionId !== feedback.interactionId ||
      request.reviewerAgentId !== feedback.reviewerAgentId ||
      request.subjectAgentId !== feedback.subjectAgentId
    )
      throw new Error('Feedback does not match its request');
    if (request.status !== 'pending') throw new Error('Feedback request is no longer pending');
    if (Date.parse(request.dueAt) <= Date.now()) throw new Error('Feedback request has expired');
    if (
      request.requestedDimensions.some(
        (dimension) => typeof feedback.ratings[dimension] !== 'number',
      )
    )
      throw new Error('Feedback must rate every requested dimension');
    const profiles = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId} AND kind = 'agent_profile' AND record_id = ${agentId}
      LIMIT 1
    `;
    const profile = profiles[0]?.payload as Partial<AgentProfile> | undefined;
    if (!profile || profile.agentVersion !== feedback.reviewerAgentVersion)
      throw new Error('Feedback reviewer version does not match the registered agent');
    let verifiedSubmissionMethod: InteractionFeedback['submissionMethod'] = submissionMethod;
    if (feedback.signature) {
      if (feedback.submissionMethod !== 'agent_signature')
        throw new Error('Signed feedback must declare agent_signature submission');
      const identities = await this.sql`
        SELECT payload FROM openclasp_records
        WHERE operator_id = ${operatorId} AND kind = 'agent' AND record_id = ${agentId}
        LIMIT 1
      `;
      const identity = AgentIdentitySchema.safeParse(identities[0]?.payload);
      if (
        !identity.success ||
        !verifyObject(feedback as unknown as Record<string, unknown>, identity.data.publicKey)
      )
        throw new Error('Feedback agent signature is invalid or unverifiable');
      verifiedSubmissionMethod = 'agent_signature';
    }
    const unattested = InteractionFeedbackSchema.parse({
      ...feedback,
      submissionMethod: verifiedSubmissionMethod,
    });
    const stored = InteractionFeedbackSchema.parse({
      ...unattested,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), unattested),
    });
    const existing = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${operatorId}
        AND kind = 'interaction_feedback'
        AND record_id = ${stored.feedbackId}
      LIMIT 1
    `;
    if (existing[0] && canonicalHash(existing[0].payload) !== canonicalHash(stored))
      throw new Error('Conflicting feedback ID');
    await this.upsert(operatorId, 'interaction_feedback', stored.feedbackId, stored);
    const requestBase = { ...request, status: 'submitted' as const };
    delete requestBase.platformAttestation;
    const updatedRequest = FeedbackRequestSchema.parse({
      ...requestBase,
      platformAttestation: attestSessionRecord(this.gatewaySecret(), requestBase),
    });
    await this.upsert(operatorId, 'feedback_request', request.requestId, updatedRequest);
    const release = await this.finalizeInteractionConclusion(feedback.interactionId);
    return {
      feedbackId: stored.feedbackId,
      status: 'submitted' as const,
      revealed: release.released && release.feedbackRevealed,
      ...(release.released ? { conclusion: release.conclusion } : {}),
    };
  }

  async processDueFeedback(now = new Date()) {
    await this.ensureSchema();
    const expiredInteractions = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = 'expired',
        payload = jsonb_set(
          jsonb_set(payload, '{status}', '"expired"'::jsonb),
          '{updatedAt}', to_jsonb(${now.toISOString()}::text)
        ),
        updated_at = NOW()
      WHERE status IN ('pending', 'active') AND expires_at <= ${now.toISOString()}
      RETURNING interaction_id
    `;
    if (expiredInteractions.length) {
      await this.sql`
        UPDATE openclasp_live_sessions
        SET status = 'failed', completed_at = COALESCE(completed_at, NOW()),
          last_error = COALESCE(last_error, 'Interaction expired before bilateral completion')
        WHERE status IN ('preparing', 'active')
          AND interaction_id IN (
            SELECT interaction_id FROM openclasp_federated_interactions
            WHERE status = 'expired' AND expires_at <= ${now.toISOString()}
          )
      `;
      await Promise.all(
        expiredInteractions.flatMap((row) => {
          const interactionId = String(row.interaction_id);
          return [
            this.journalFederatedInteraction(interactionId),
            this.journalLiveSessionState(interactionId),
          ];
        }),
      );
    }
    const [rows, backfillRows] = await Promise.all([
      this.sql`
        SELECT operator_id, record_id, payload FROM openclasp_records
        WHERE kind = 'feedback_request'
          AND payload->>'status' = 'pending'
          AND (payload->>'dueAt')::timestamptz <= ${now.toISOString()}
        LIMIT 500
      `,
      this.sql`
        SELECT source.interaction_id
        FROM (
          SELECT conclusion.payload->>'interactionId' AS interaction_id
          FROM openclasp_records conclusion
          WHERE conclusion.kind = 'interaction_conclusion'
            AND NOT EXISTS (
              SELECT 1 FROM openclasp_records eligibility
              WHERE eligibility.operator_id = conclusion.operator_id
                AND eligibility.kind = 'learning_eligibility'
                AND eligibility.payload->>'interactionId' = conclusion.payload->>'interactionId'
            )
          UNION
          SELECT report.payload->>'interactionId' AS interaction_id
          FROM openclasp_records report
          WHERE report.kind = 'completion_report'
            AND NOT EXISTS (
              SELECT 1 FROM openclasp_records conclusion
              WHERE conclusion.kind = 'interaction_conclusion'
                AND conclusion.payload->>'interactionId' = report.payload->>'interactionId'
            )
        ) source
        WHERE source.interaction_id IS NOT NULL
        GROUP BY source.interaction_id
        ORDER BY source.interaction_id ASC
        LIMIT 200
      `,
    ]);
    const interactions = new Set<string>();
    for (const row of rows) {
      const request = FeedbackRequestSchema.parse(row.payload);
      const base = { ...request, status: 'expired' as const };
      delete base.platformAttestation;
      const expired = FeedbackRequestSchema.parse({
        ...base,
        platformAttestation: attestSessionRecord(this.gatewaySecret(), base),
      });
      await this.upsert(
        String(row.operator_id),
        'feedback_request',
        String(row.record_id),
        expired,
      );
      interactions.add(request.interactionId);
    }
    for (const row of backfillRows) interactions.add(String(row.interaction_id));
    let released = 0;
    for (const interactionId of interactions) {
      const result = await this.finalizeInteractionConclusion(interactionId);
      if (result.released) released += 1;
    }
    return {
      expired: rows.length,
      interactionsExpired: expiredInteractions.length,
      released,
      backfilled: backfillRows.length,
    };
  }

  async recordSessionFeedback(token: string, value: InteractionFeedback) {
    const feedback = InteractionFeedbackSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (
      grant.interactionId !== feedback.interactionId ||
      grant.senderAgentId !== feedback.reviewerAgentId ||
      grant.recipientAgentId !== feedback.subjectAgentId
    )
      throw new Error('Session credential does not match the feedback');
    const owners = await this.sql`
      SELECT initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${feedback.interactionId}
      LIMIT 1
    `;
    const row = owners[0];
    if (!row) throw new Error('Interaction not found');
    const operatorId = String(
      row.initiator_agent_id === feedback.reviewerAgentId
        ? row.initiator_operator_id
        : row.responder_operator_id,
    );
    return this.submitInteractionFeedback(
      operatorId,
      feedback.reviewerAgentId,
      feedback,
      'runtime_session',
    );
  }

  async recordLiveSessionEvent(token: string, value: LiveSessionEvent) {
    await this.ensureSchema();
    const event = LiveSessionEventSchema.parse(value);
    const grant = this.verifySessionGrant(token);
    if (grant.interactionId !== event.interactionId || grant.senderAgentId !== event.agentId)
      throw new Error('Session credential does not match the event');
    const sessions = await this.sql`
      SELECT 1 FROM openclasp_live_sessions
      WHERE interaction_id = ${event.interactionId}
        AND status = 'active'
        AND ${event.agentId} IN (initiator_agent_id, responder_agent_id)
    `;
    if (!sessions.length) throw new Error('Active live session not found');
    const attestation = attestSessionRecord(this.gatewaySecret(), event);
    const encoded = JSON.stringify({ ...event, attestation });
    const rows = await this.sql`
      INSERT INTO openclasp_live_session_events(
        interaction_id, event_id, agent_id, sequence, event
      ) SELECT ${event.interactionId}, ${event.eventId}, ${event.agentId}, ${event.sequence}, ${encoded}::jsonb
      WHERE (
        SELECT COUNT(*) FROM openclasp_live_session_events
        WHERE interaction_id = ${event.interactionId}
      ) < 1000
      ON CONFLICT DO NOTHING
      RETURNING event_id
    `;
    if (rows.length)
      await this.journalLiveSessionEvent({
        ...event,
        attestation,
      });
    if (event.type === 'session_completed' || event.type === 'session_failed') {
      const terminal = await this.sql`
        SELECT COUNT(DISTINCT agent_id) AS count
        FROM openclasp_live_session_events
        WHERE interaction_id = ${event.interactionId}
          AND event->>'type' IN ('session_completed', 'session_failed')
      `;
      if (Number(terminal[0]?.count ?? 0) >= 2) {
        await this.sql`
          UPDATE openclasp_live_sessions SET status = 'completed', completed_at = NOW()
          WHERE interaction_id = ${event.interactionId} AND status = 'active'
        `;
        const completedAt = new Date().toISOString();
        await this.sql`
          UPDATE openclasp_federated_interactions
          SET status = 'completed',
            payload = jsonb_set(
              jsonb_set(payload, '{status}', '"completed"'::jsonb),
              '{updatedAt}', to_jsonb(${completedAt}::text)
            ),
            updated_at = NOW()
          WHERE interaction_id = ${event.interactionId} AND status = 'active'
        `;
        await Promise.all([
          this.journalLiveSessionState(event.interactionId),
          this.journalFederatedInteraction(event.interactionId),
        ]);
      }
    }
    return {
      recorded: rows.length > 0,
      deduplicated: rows.length === 0,
      eventId: event.eventId,
      attestation,
    };
  }

  async createFederatedInteraction(
    operatorId: string,
    value: FederatedInteraction,
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    let interaction = FederatedInteractionSchema.parse(value);
    if (interaction.status !== 'pending') throw new Error('New interactions must be pending');
    if (interaction.contractRevision !== 1 || interaction.contractRevisions.length)
      throw new Error('New interactions cannot supply contract revision history');
    if (interaction.contract.interactionId !== interaction.interactionId)
      throw new Error('Contract interaction ID does not match');
    if (canonicalHash(interaction.contract) !== interaction.termsHash)
      throw new Error('Contract hash does not match the immutable terms');
    if (
      interaction.contract.parties.length !== 2 ||
      interaction.contract.parties[0] !== interaction.initiatorAgentId ||
      interaction.contract.parties[1] !== interaction.responderAgentId
    )
      throw new Error('Contract parties do not match the interaction participants');
    const acceptanceEntries = Object.entries(interaction.acceptances);
    if (
      acceptanceEntries.length !== 1 ||
      acceptanceEntries[0]?.[0] !== interaction.initiatorAgentId ||
      acceptanceEntries[0]?.[1].agentId !== interaction.initiatorAgentId ||
      acceptanceEntries[0]?.[1].termsHash !== interaction.termsHash ||
      !['oauth_installation', 'oauth_account'].includes(acceptanceEntries[0]?.[1].method ?? '')
    )
      throw new Error('A pending interaction requires only the initiator acceptance');
    if (Date.parse(interaction.expiresAt) <= Date.now())
      throw new Error('Interaction expiry must be in the future');
    interaction = withContractRevisionHistory(interaction);
    const owners = await this.sql`
      SELECT agent_id, operator_id, card FROM openclasp_public_agents
      WHERE agent_id IN (${interaction.initiatorAgentId}, ${interaction.responderAgentId})
    `;
    const initiator = owners.find((row) => row.agent_id === interaction.initiatorAgentId);
    const responder = owners.find((row) => row.agent_id === interaction.responderAgentId);
    if (!initiator || initiator.operator_id !== operatorId)
      throw new Error('The initiating agent must be published and owned by this account');
    if (!responder) throw new Error('Responder is not a published OpenClasp agent');
    if (responder.operator_id === operatorId)
      throw new Error('Federated interactions require agents from different accounts');
    const responderCard = normalizePublicAgentCard(responder.card);
    if (
      !responderCard.transports.some(
        (transport) =>
          transport.endpoint === interaction.responderTransport.endpoint &&
          transport.protocolBinding === interaction.responderTransport.protocolBinding,
      )
    )
      throw new Error('Responder transport does not match its published Agent Card');
    const encoded = JSON.stringify(interaction);
    const rows = await this.sql`
      INSERT INTO openclasp_federated_interactions(
        interaction_id, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id, status, payload, expires_at
      ) VALUES (
        ${interaction.interactionId}, ${operatorId}, ${responder.operator_id},
        ${interaction.initiatorAgentId}, ${interaction.responderAgentId},
        ${interaction.status}, ${encoded}::jsonb, ${interaction.expiresAt}
      )
      RETURNING payload
    `;
    const stored = FederatedInteractionSchema.parse(rows[0]?.payload);
    await this.journalFederatedInteraction(stored.interactionId);
    const profiles = await this.sql`
      SELECT payload FROM openclasp_records
      WHERE operator_id = ${responder.operator_id}
        AND kind = 'agent_profile'
        AND record_id = ${interaction.responderAgentId}
      LIMIT 1
    `;
    const responderProfile = profiles[0]?.payload as AgentProfile | undefined;
    if (responderProfile && canAutoAcceptInteraction(responderProfile, stored))
      return this.respondToFederatedInteraction(
        String(responder.operator_id),
        stored.interactionId,
        stored.responderAgentId,
        'accept',
        'policy_auto_accept',
      );
    return stored;
  }

  async listFederatedInteractions(operatorId: string): Promise<FederatedInteraction[]> {
    await this.ensureSchema();
    const expired = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = 'expired', payload = jsonb_set(payload, '{status}', '"expired"'::jsonb), updated_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()
      RETURNING interaction_id
    `;
    await Promise.all(
      expired.map((row) => this.journalFederatedInteraction(String(row.interaction_id))),
    );
    const rows = await this.sql`
      SELECT payload FROM openclasp_federated_interactions
      WHERE initiator_operator_id = ${operatorId} OR responder_operator_id = ${operatorId}
      ORDER BY updated_at DESC
    `;
    return rows.map((row) =>
      withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload)),
    );
  }

  async getFederatedInteraction(
    operatorId: string,
    interactionId: string,
  ): Promise<FederatedInteraction | undefined> {
    const values = await this.listFederatedInteractions(operatorId);
    return values.find((value) => value.interactionId === interactionId);
  }

  async respondToFederatedInteraction(
    operatorId: string,
    interactionId: string,
    agentId: string,
    decision: 'accept' | 'reject',
    method: 'oauth_installation' | 'oauth_account' | 'policy_auto_accept' = 'oauth_account',
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, responder_operator_id, responder_agent_id
      FROM openclasp_federated_interactions WHERE interaction_id = ${interactionId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction invitation not found');
    if (row.responder_operator_id !== operatorId || row.responder_agent_id !== agentId)
      throw new Error('Only the invited agent may respond');
    const current = withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload));
    if (current.status !== 'pending') throw new Error('Invitation is no longer pending');
    const now = new Date().toISOString();
    if (Date.parse(current.expiresAt) <= Date.now()) {
      const expired = { ...current, status: 'expired' as const, updatedAt: now };
      await this.updateFederatedInteraction(
        interactionId,
        current.status,
        expired,
        current.updatedAt,
      );
      throw new Error('Invitation has expired');
    }
    const proposed = openContractRevision(current);
    if (!proposed || proposed.termsHash !== current.termsHash)
      throw new Error('No current contract proposal is available');
    const acceptance = {
      agentId,
      method,
      termsHash: current.termsHash,
      acceptedAt: now,
    };
    const proposalBase: ContractRevision = {
      ...proposed,
      status: decision === 'accept' ? 'accepted' : 'rejected',
      acceptances:
        decision === 'accept'
          ? { ...proposed.acceptances, [agentId]: acceptance }
          : proposed.acceptances,
      updatedAt: now,
    };
    const resolvedProposal =
      decision === 'accept'
        ? ContractRevisionSchema.parse({
            ...proposalBase,
            platformAttestation: attestSessionRecord(this.gatewaySecret(), proposalBase),
          })
        : proposalBase;
    const next = FederatedInteractionSchema.parse({
      ...current,
      status: decision === 'accept' ? 'active' : 'rejected',
      updatedAt: now,
      acceptances: decision === 'accept' ? resolvedProposal.acceptances : current.acceptances,
      contractRevisions: current.contractRevisions.map((revision) =>
        revision.revisionId === resolvedProposal.revisionId ? resolvedProposal : revision,
      ),
    });
    if (decision === 'accept') {
      try {
        await this.brokerLiveSession(next);
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 500) : 'Live session failed';
        await this.sql`
          UPDATE openclasp_agent_runtimes SET last_error = ${reason}, updated_at = NOW()
          WHERE agent_id IN (${current.initiatorAgentId}, ${current.responderAgentId})
        `;
        throw error;
      }
    }
    const updated = await this.updateFederatedInteraction(
      interactionId,
      current.status,
      next,
      current.updatedAt,
    );
    if (!updated) throw new Error('Invitation was already handled');
    return next;
  }

  async proposeContractRevision(
    operatorId: string,
    interactionId: string,
    agentId: string,
    contract: InteractionContract,
    expectedTermsHash?: string,
    method: 'oauth_installation' | 'oauth_account' = 'oauth_account',
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction not found');
    const ownsParticipant =
      (row.initiator_operator_id === operatorId && row.initiator_agent_id === agentId) ||
      (row.responder_operator_id === operatorId && row.responder_agent_id === agentId);
    if (!ownsParticipant) throw new Error('Only a participating agent may propose contract terms');
    const current = withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload));
    if (!['pending', 'active'].includes(current.status))
      throw new Error('This interaction no longer accepts contract proposals');
    const parsedContract = InteractionContractSchema.parse(contract);
    if (parsedContract.interactionId !== interactionId)
      throw new Error('Contract interaction ID does not match');
    if (
      parsedContract.parties.length !== 2 ||
      parsedContract.parties[0] !== current.initiatorAgentId ||
      parsedContract.parties[1] !== current.responderAgentId
    )
      throw new Error('Contract parties cannot change during negotiation');
    const open = openContractRevision(current);
    const expected = open?.termsHash ?? current.termsHash;
    if (expectedTermsHash && expectedTermsHash !== expected)
      throw new Error('Contract terms changed; fetch the interaction before countering');
    const termsHash = canonicalHash(parsedContract);
    if (termsHash === expected) throw new Error('Proposed terms are unchanged');
    const now = new Date().toISOString();
    const revisionNumber =
      Math.max(
        current.contractRevision,
        ...current.contractRevisions.map((item) => item.revision),
      ) + 1;
    const acceptance = {
      agentId,
      method,
      termsHash,
      acceptedAt: now,
    } as const;
    const revision = ContractRevisionSchema.parse({
      revisionId: crypto.randomUUID(),
      interactionId,
      revision: revisionNumber,
      previousTermsHash: expected,
      termsHash,
      contract: parsedContract,
      proposedByAgentId: agentId,
      status: 'proposed',
      acceptances: { [agentId]: acceptance },
      createdAt: now,
      updatedAt: now,
    });
    const revisions = [
      ...current.contractRevisions.map((item) =>
        item.status === 'proposed'
          ? ContractRevisionSchema.parse({ ...item, status: 'superseded', updatedAt: now })
          : item,
      ),
      revision,
    ];
    const next = FederatedInteractionSchema.parse({
      ...current,
      ...(current.status === 'pending'
        ? {
            contract: parsedContract,
            termsHash,
            acceptances: revision.acceptances,
            contractRevision: revisionNumber,
          }
        : {}),
      contractRevisions: revisions,
      updatedAt: now,
    });
    const updated = await this.updateFederatedInteraction(
      interactionId,
      current.status,
      next,
      current.updatedAt,
    );
    if (!updated) throw new Error('Contract changed concurrently; fetch it and retry');
    return next;
  }

  async respondToContractRevision(
    operatorId: string,
    interactionId: string,
    agentId: string,
    revisionId: string,
    decision: 'accept' | 'reject',
    method: 'oauth_installation' | 'oauth_account' = 'oauth_account',
  ): Promise<FederatedInteraction> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload, initiator_operator_id, responder_operator_id,
        initiator_agent_id, responder_agent_id
      FROM openclasp_federated_interactions
      WHERE interaction_id = ${interactionId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Interaction not found');
    const ownsParticipant =
      (row.initiator_operator_id === operatorId && row.initiator_agent_id === agentId) ||
      (row.responder_operator_id === operatorId && row.responder_agent_id === agentId);
    if (!ownsParticipant) throw new Error('Only a participating agent may respond to terms');
    const current = withContractRevisionHistory(FederatedInteractionSchema.parse(row.payload));
    if (!['pending', 'active'].includes(current.status))
      throw new Error('This interaction no longer accepts contract responses');
    const proposal = openContractRevision(current);
    if (!proposal || proposal.revisionId !== revisionId)
      throw new Error('Contract proposal is no longer current');
    if (proposal.acceptances[agentId]) throw new Error('Agent already accepted this proposal');
    const now = new Date().toISOString();
    const acceptances =
      decision === 'accept'
        ? {
            ...proposal.acceptances,
            [agentId]: { agentId, method, termsHash: proposal.termsHash, acceptedAt: now },
          }
        : proposal.acceptances;
    const fullyAccepted = current.contract.parties.every((party) => party in acceptances);
    const revisionBase = ContractRevisionSchema.parse({
      ...proposal,
      status: decision === 'reject' ? 'rejected' : fullyAccepted ? 'accepted' : 'proposed',
      acceptances,
      updatedAt: now,
    });
    const revision =
      fullyAccepted && decision === 'accept'
        ? ContractRevisionSchema.parse({
            ...revisionBase,
            platformAttestation: attestSessionRecord(this.gatewaySecret(), revisionBase),
          })
        : revisionBase;
    const next = FederatedInteractionSchema.parse({
      ...current,
      status:
        current.status === 'pending'
          ? decision === 'reject'
            ? 'rejected'
            : fullyAccepted
              ? 'active'
              : 'pending'
          : 'active',
      ...(fullyAccepted
        ? {
            contract: revision.contract,
            termsHash: revision.termsHash,
            acceptances: revision.acceptances,
            contractRevision: revision.revision,
          }
        : {}),
      contractRevisions: current.contractRevisions.map((item) =>
        item.revisionId === revision.revisionId ? revision : item,
      ),
      updatedAt: now,
    });
    if (current.status === 'pending' && decision === 'accept' && fullyAccepted)
      await this.brokerLiveSession(next);
    const updated = await this.updateFederatedInteraction(
      interactionId,
      current.status,
      next,
      current.updatedAt,
    );
    if (!updated) throw new Error('Contract changed concurrently; fetch it and retry');
    return next;
  }

  private async updateFederatedInteraction(
    interactionId: string,
    expectedStatus: string,
    value: FederatedInteraction,
    expectedUpdatedAt?: string,
  ): Promise<boolean> {
    const encoded = JSON.stringify(FederatedInteractionSchema.parse(value));
    const rows = await this.sql`
      UPDATE openclasp_federated_interactions
      SET status = ${value.status}, payload = ${encoded}::jsonb, updated_at = NOW()
      WHERE interaction_id = ${interactionId} AND status = ${expectedStatus}
        AND (${expectedUpdatedAt ?? null}::text IS NULL OR payload->>'updatedAt' = ${expectedUpdatedAt ?? null})
      RETURNING interaction_id
    `;
    if (rows.length) await this.journalFederatedInteraction(interactionId);
    return rows.length > 0;
  }

  async getSettings(operatorId: string): Promise<AccountSettings> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT display_name, contribution_enabled
      FROM openclasp_account_settings
      WHERE operator_id = ${operatorId}
    `;
    const row = rows[0] as
      | {
          display_name: string;
          contribution_enabled: boolean;
        }
      | undefined;
    return row
      ? {
          displayName: row.display_name,
          contributionEnabled: row.contribution_enabled,
          rawConversationsStored: false,
        }
      : defaults;
  }

  async saveSettings(
    operatorId: string,
    settings: Omit<AccountSettings, 'rawConversationsStored'>,
  ): Promise<AccountSettings> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO openclasp_account_settings(
        operator_id, display_name, contribution_enabled
      ) VALUES (
        ${operatorId}, ${settings.displayName}, ${settings.contributionEnabled}
      )
      ON CONFLICT (operator_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        contribution_enabled = EXCLUDED.contribution_enabled,
        updated_at = NOW()
    `;
    return { ...settings, rawConversationsStored: false };
  }
}
