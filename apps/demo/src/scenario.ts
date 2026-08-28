import { randomUUID } from 'node:crypto';
import {
  canonicalHash,
  signNamed,
  signObject,
  type Feedback,
  type InteractionContract,
  type Receipt,
} from '../../../packages/protocol/src/index.js';
import {
  createIdentity,
  FixtureFactCheckProvider,
  TrustEngine,
} from '../../../packages/core/src/index.js';
import { createSignedEnvelope, createSignedEvent } from '../../../packages/sdk/src/index.js';
import { OpenClaspSidecar, openClaspA2AExtension } from '../../../packages/sidecar/src/index.js';

export async function runDemo(log: (line: string) => void = () => undefined) {
  const engine = new TrustEngine();
  const requester = createIdentity({
    agentId: 'agent:requester',
    operatorRef: 'operator:acme',
    capabilities: ['research.request'],
  });
  const provider = createIdentity({
    agentId: 'agent:provider',
    operatorRef: 'operator:labs',
    capabilities: ['research.answer', 'research.delegate'],
  });
  const subagent = createIdentity({
    agentId: 'agent:provider:subagent',
    operatorRef: 'operator:labs',
    capabilities: ['research.answer'],
    parentAgentId: provider.identity.agentId,
    rootControllerId: provider.identity.rootControllerId,
  });
  for (const agent of [requester, provider, subagent]) engine.registerAgent(agent.identity);
  log('1. Created and verified requester, provider, and subagent identities');

  const delegation = engine.createDelegation(
    provider.identity.agentId,
    subagent.identity.agentId,
    ['research.answer'],
    new Date(Date.now() + 60_000).toISOString(),
    provider.keyPair,
  );
  if (!engine.verifyDelegation(delegation.delegationId, 'research.answer'))
    throw new Error('Delegation verification failed');
  log('2. Verified scoped parent/subagent delegation');

  const interactionId = randomUUID();
  const baseContract: InteractionContract = {
    protocolVersion: '0.1',
    interactionId,
    purpose: 'Summarize a public research fixture',
    parties: [requester.identity.agentId, provider.identity.agentId],
    taskCategory: 'research.summary',
    requestedOutcome: 'Evidence-backed summary',
    successCriteria: ['Citations included'],
    allowedActions: ['research.answer'],
    prohibitedActions: ['publish.private_data'],
    allowedData: ['public'],
    prohibitedData: ['private'],
    evidenceRequirements: ['authoritative_source'],
    delegationRules: ['research.answer'],
    humanApprovalRequirements: ['publish'],
    factCheckingPolicy: 'important_claims',
    mediationPolicy: 'mutual_consent',
    retentionDays: 30,
    completionConditions: ['summary_delivered'],
    cancellationConditions: ['either_party'],
    signatures: {},
  };
  const requesterSigned = signNamed(
    baseContract as unknown as Record<string, unknown>,
    requester.identity.agentId,
    requester.keyPair,
  ) as unknown as InteractionContract;
  const contract = signNamed(
    requesterSigned as unknown as Record<string, unknown>,
    provider.identity.agentId,
    provider.keyPair,
  ) as unknown as InteractionContract;
  engine.saveContract(contract);
  log('3. Exchanged expectations and signed a minimal interaction contract');

  engine.setContributionConsent(provider.identity.agentId, true);
  const contractHash = canonicalHash({ ...contract, signatures: {} });
  const envelope = createSignedEnvelope(
    {
      protocolVersion: '0.1',
      interactionId,
      requestingAgentId: requester.identity.agentId,
      respondingAgentId: provider.identity.agentId,
      rootControllerId: requester.identity.rootControllerId,
      agentVersion: requester.identity.agentVersion,
      requestedCapability: 'research.answer',
      taskCategory: 'research.summary',
      contractHash,
      dataSharingMode: 'structured_only',
      evidenceRequirements: ['authoritative_source'],
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: randomUUID(),
    },
    requester.keyPair,
  );
  const claim = 'OpenClasp uses a blockchain';
  const claimEvent = createSignedEvent(
    {
      protocolVersion: '0.1',
      eventId: randomUUID(),
      interactionId,
      eventType: 'claim',
      agentId: provider.identity.agentId,
      agentVersion: provider.identity.agentVersion,
      timestamp: new Date().toISOString(),
      visibility: 'network_aggregate',
      provenance: 'observed',
      payload: { claim },
      evidenceRefs: [],
    },
    provider.keyPair,
  );
  const sidecar = new OpenClaspSidecar(engine);
  const extension = openClaspA2AExtension();
  const forwarding = await sidecar.forward({
    message: {
      role: 'ROLE_USER',
      parts: [{ text: 'Provide the summary' }],
      extensions: [extension.uri ?? ''],
      metadata: { [extension.uri ?? '']: envelope, rawMessage: 'must stay local' },
    },
    envelope,
    policy: { action: 'research.answer', dataClasses: ['public'] },
    structuredEvents: [claimEvent],
    send: async () => ({ kind: 'message', text: claim }),
  });
  if (
    !forwarding.forwarded ||
    JSON.stringify(forwarding.networkPayloads).includes('rawMessage') ||
    JSON.stringify(forwarding.networkPayloads).includes(claim)
  )
    throw new Error('Structured-only privacy boundary failed');
  log('4. Forwarded an A2A message with trust metadata; raw content stayed local');

  const factChecker = new FixtureFactCheckProvider({
    [claim]: { status: 'contradicted', evidence: ['docs:data-boundary#no-blockchain'] },
  });
  const check = await factChecker.check(claim);
  if (check.status !== 'contradicted') throw new Error('Fact check did not contradict fixture');
  log('5. Issued a private evidence-backed contradiction warning');

  const blockedEnvelope = createSignedEnvelope(
    { ...envelope, nonce: randomUUID(), timestamp: new Date().toISOString() },
    requester.keyPair,
  );
  const blocked = engine.assess({
    envelope: blockedEnvelope,
    action: 'publish.private_data',
    dataClasses: ['private'],
  });
  if (blocked.decision !== 'DENY') throw new Error('Scope violation was not blocked');
  log('6. Blocked deterministic out-of-scope and prohibited-data action');

  const conflict = engine.createConflict({
    interactionId,
    issue: 'Unsupported factual claim',
    participants: [requester.identity.agentId, provider.identity.agentId],
    positions: {
      [requester.identity.agentId]: 'Claim is contradicted',
      [provider.identity.agentId]: 'Claim should be corrected',
    },
    evidence: check.evidenceReferences,
    contractClauses: ['evidenceRequirements'],
    missingInformation: [],
    possibleResolutions: ['Correct the claim and cite the architecture'],
  });
  engine.permitMediation(conflict.conflictId, requester.identity.agentId);
  engine.permitMediation(conflict.conflictId, provider.identity.agentId);
  engine.resolveConflict(conflict.conflictId, 'Provider corrected the claim');
  log('7. Opened and resolved a mutually consented conflict');

  const baseReceipt: Receipt = {
    receiptId: randomUUID(),
    interactionId,
    participants: [requester.identity.agentId, provider.identity.agentId],
    agentVersions: { [requester.identity.agentId]: '1.0.0', [provider.identity.agentId]: '1.0.0' },
    contractHash,
    startedAt: contract.signatures[requester.identity.agentId]
      ? new Date(Date.now() - 5000).toISOString()
      : new Date().toISOString(),
    completedAt: new Date().toISOString(),
    outcome: 'success',
    commitmentsFulfilled: ['summary_delivered'],
    commitmentsMissed: [],
    evidenceHashes: [canonicalHash(check.evidenceReferences)],
    policyWarnings: ['contradicted_claim'],
    policyViolations: ['blocked_scope_attempt'],
    disputeStatus: 'resolved',
    delegationChainHash: canonicalHash(delegation),
    unilateral: false,
    signatures: {},
  };
  const receiptOne = signNamed(
    baseReceipt as unknown as Record<string, unknown>,
    requester.identity.agentId,
    requester.keyPair,
  ) as unknown as Receipt;
  const receipt = signNamed(
    receiptOne as unknown as Record<string, unknown>,
    provider.identity.agentId,
    provider.keyPair,
  ) as unknown as Receipt;
  engine.submitReceipt(receipt);
  log('8. Independently verified a bilateral completion receipt');

  const feedbackBase = (
    reviewer: typeof requester,
    subject: typeof provider,
  ): Omit<Feedback, 'signature'> => ({
    feedbackId: randomUUID(),
    interactionId,
    receiptId: receipt.receiptId,
    reviewerAgentId: reviewer.identity.agentId,
    subjectAgentId: subject.identity.agentId,
    taskCompleted: true,
    outputAccepted: true,
    specificationMatched: true,
    deadlineMet: true,
    communicationQuality: 0.9,
    evidenceProvided: true,
    scopeRespected: true,
    disputeRaised: false,
    submittedAt: new Date().toISOString(),
  });
  const firstFeedback = signObject(
    feedbackBase(requester, provider),
    requester.keyPair,
  ) as Feedback;
  const secondFeedback = signObject(
    feedbackBase(provider, requester),
    provider.keyPair,
  ) as Feedback;
  if (engine.submitFeedback(firstFeedback).revealed) throw new Error('Feedback revealed too early');
  if (!engine.submitFeedback(secondFeedback).revealed)
    throw new Error('Bilateral feedback was not revealed');
  const learnedRisk = engine.getRisk(provider.identity.agentId, '1.0.0', 'research.summary');
  const newVersionRisk = engine.getRisk(provider.identity.agentId, '2.0.0', 'research.summary');
  if (learnedRisk.sampleSize !== 1 || newVersionRisk.confidence >= learnedRisk.confidence)
    throw new Error('Behavioural learning/version reduction failed');
  log('9. Updated contextual history; new versions inherit reduced confidence');

  const tampered = { ...receipt, outcome: 'failure' as const };
  let tamperRejected = false;
  try {
    engine.submitReceipt(tampered);
  } catch {
    tamperRejected = true;
  }
  const expired = engine.createDelegation(
    provider.identity.agentId,
    subagent.identity.agentId,
    ['research.answer'],
    new Date(Date.now() - 1000).toISOString(),
    provider.keyPair,
  );
  const replay = engine.assess({ envelope, action: 'research.answer' });
  const invalidIdentity = { ...requester.identity, operatorRef: 'operator:attacker' };
  let invalidRejected = false;
  try {
    engine.registerAgent(invalidIdentity);
  } catch {
    invalidRejected = true;
  }
  if (
    !tamperRejected ||
    engine.verifyDelegation(expired.delegationId) ||
    replay.decision !== 'DENY' ||
    !invalidRejected
  )
    throw new Error('Adversarial checks failed');
  log('10. Rejected tampered receipt, expired delegation, replay, and invalid signature');

  const unilateralBase = {
    ...baseReceipt,
    receiptId: randomUUID(),
    unilateral: true,
    signatures: {},
  };
  const unilateral = signNamed(
    unilateralBase as unknown as Record<string, unknown>,
    requester.identity.agentId,
    requester.keyPair,
  ) as unknown as Receipt;
  engine.submitReceipt(unilateral);
  log('11. Produced a clearly labelled unilateral receipt');
  return { engine, learnedRisk, newVersionRisk, forwarding, check, receipt };
}
