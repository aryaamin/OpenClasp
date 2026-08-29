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
  managedBy: z.literal('openclasp').default('openclasp'),
});

export const AgentPresenceSchema = z.object({
  status: z.enum(['online', 'offline']),
  lastSeenAt: z.string().datetime().optional(),
  checkedAt: z.string().datetime(),
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
  transports: z.array(AgentTransportSchema),
  cardUrl: z.string().url(),
  a2aAgentCardUrl: z.string().url(),
  extensionUri: z.string().url(),
  presence: AgentPresenceSchema.optional(),
  publishedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ContractAcceptanceSchema = z.object({
  agentId: z.string().min(1),
  method: z.enum(['oauth_installation', 'oauth_account', 'policy_auto_accept', 'ed25519']),
  termsHash: z.string().min(1),
  acceptedAt: z.string().datetime(),
  signature: SignatureSchema.optional(),
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
  initiatorTransport: AgentTransportSchema.optional(),
  responderTransport: AgentTransportSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

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
  signatures: z.record(z.string(), SignatureSchema).default({}),
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
export type AgentPresence = z.infer<typeof AgentPresenceSchema>;
export type PublicAgentCard = z.infer<typeof PublicAgentCardSchema>;
export type ContractAcceptance = z.infer<typeof ContractAcceptanceSchema>;
export type FederatedInteraction = z.infer<typeof FederatedInteractionSchema>;

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
