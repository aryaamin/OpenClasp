import { randomUUID } from 'node:crypto';
import {
  AgentIdentitySchema,
  canonicalHash,
  createKeyPair,
  DelegationCredentialSchema,
  FeedbackSchema,
  InteractionContractSchema,
  InteractionEventSchema,
  ReceiptSchema,
  signNamed,
  signObject,
  TrustEnvelopeSchema,
  verifyNamed,
  verifyObject,
  type AgentIdentity,
  type DelegationCredential,
  type FactCheckResult,
  type Feedback,
  type InteractionContract,
  type InteractionEvent,
  type KeyPair,
  type Receipt,
  type RiskDecision,
  type TrustEnvelope,
} from '../../protocol/src/index.js';

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
