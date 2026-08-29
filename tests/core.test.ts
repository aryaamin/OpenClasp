import { describe, expect, it } from 'vitest';
import {
  buildCounterpartyBrief,
  buildInteractionConclusion,
  createIdentity,
  deriveBehaviouralObservations,
  evaluateLearningEligibility,
  FixtureFactCheckProvider,
  TrustEngine,
  updateContextualBehaviouralProfile,
} from '@openclasp/core';
import {
  canonicalHash,
  InteractionCompletionReportSchema,
  InteractionFeedbackSchema,
  PublicAgentCardSchema,
  signNamed,
  type InteractionContract,
  type InteractionConclusion,
  type InteractionCompletionReport,
  type InteractionFeedback,
  type Receipt,
} from '@openclasp/protocol';
import { createSignedEvent } from '@openclasp/sdk';

describe('general assurance behavior', () => {
  it('requires every contract party to sign before the agreement is active', () => {
    const engine = new TrustEngine();
    const first = createIdentity({
      agentId: 'agent:first',
      operatorRef: 'operator:a',
      capabilities: ['coordinate'],
    });
    const second = createIdentity({
      agentId: 'agent:second',
      operatorRef: 'operator:b',
      capabilities: ['coordinate'],
    });
    engine.registerAgent(first.identity);
    engine.registerAgent(second.identity);
    const unsigned: InteractionContract = {
      protocolVersion: '0.1',
      interactionId: crypto.randomUUID(),
      purpose: 'Coordinate a task',
      parties: [first.identity.agentId, second.identity.agentId],
      taskCategory: 'coordination',
      requestedOutcome: 'Agreed plan',
      successCriteria: ['Plan accepted'],
      allowedActions: ['coordinate'],
      prohibitedActions: [],
      allowedData: ['public'],
      prohibitedData: ['private'],
      evidenceRequirements: [],
      delegationRules: [],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent',
      retentionDays: 30,
      completionConditions: ['plan_delivered'],
      cancellationConditions: ['either_party'],
      signatures: {},
    };
    const oneSignature = signNamed(
      unsigned as unknown as Record<string, unknown>,
      first.identity.agentId,
      first.keyPair,
    ) as unknown as InteractionContract;
    expect(() => engine.saveContract(oneSignature)).toThrow('every party');
    const complete = signNamed(
      oneSignature as unknown as Record<string, unknown>,
      second.identity.agentId,
      second.keyPair,
    ) as unknown as InteractionContract;
    expect(engine.saveContract(complete).interactionId).toBe(unsigned.interactionId);
  });

  it('does not fact-check opinions as objective truth', async () => {
    const provider = new FixtureFactCheckProvider();
    expect((await provider.check('I think green is the best color')).status).toBe(
      'not_fact_checkable',
    );
  });

  it('verifies a receipt without recording it', () => {
    const engine = new TrustEngine();
    const agent = createIdentity({
      agentId: 'agent:receipt',
      operatorRef: 'operator:a',
      capabilities: ['work'],
    });
    engine.registerAgent(agent.identity);
    const base: Receipt = {
      receiptId: crypto.randomUUID(),
      interactionId: crypto.randomUUID(),
      participants: [agent.identity.agentId],
      agentVersions: { [agent.identity.agentId]: '1.0.0' },
      contractHash: 'contract',
      startedAt: new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
      outcome: 'success',
      commitmentsFulfilled: ['done'],
      commitmentsMissed: [],
      evidenceHashes: [],
      policyWarnings: [],
      policyViolations: [],
      disputeStatus: 'none',
      delegationChainHash: 'none',
      unilateral: false,
      signatures: {},
    };
    const signed = signNamed(
      base as unknown as Record<string, unknown>,
      agent.identity.agentId,
      agent.keyPair,
    ) as unknown as Receipt;
    expect(engine.verifyReceipt(signed).receiptId).toBe(base.receiptId);
    expect(engine.receipts.size).toBe(0);
  });

  it('requires opt-in and strips payloads from network contributions', () => {
    const engine = new TrustEngine();
    const agent = createIdentity({
      agentId: 'agent:a',
      operatorRef: 'operator:a',
      capabilities: ['chat'],
    });
    engine.registerAgent(agent.identity);
    const event = createSignedEvent(
      {
        protocolVersion: '0.1',
        eventId: crypto.randomUUID(),
        interactionId: crypto.randomUUID(),
        eventType: 'claim',
        agentId: agent.identity.agentId,
        agentVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        visibility: 'network_aggregate',
        provenance: 'observed',
        payload: { rawMessage: 'private conversation', claim: 'secret' },
      },
      agent.keyPair,
    );
    expect(engine.networkContribution(event)).toBeNull();
    engine.setContributionConsent(agent.identity.agentId, true);
    const contribution = engine.networkContribution(event);
    expect(contribution).not.toHaveProperty('payload');
    expect(JSON.stringify(contribution)).not.toContain('private conversation');
  });

  it('requires mutual mediation consent', () => {
    const engine = new TrustEngine();
    const conflict = engine.createConflict({
      interactionId: crypto.randomUUID(),
      issue: 'ambiguous requirement',
      participants: ['a', 'b'],
      positions: {},
      evidence: [],
      contractClauses: [],
      missingInformation: [],
      possibleResolutions: ['clarify'],
    });
    engine.permitMediation(conflict.conflictId, 'a');
    expect(() => engine.resolveConflict(conflict.conflictId, 'clarified')).toThrow('Mutual');
    engine.permitMediation(conflict.conflictId, 'b');
    expect(engine.resolveConflict(conflict.conflictId, 'clarified').status).toBe('resolved');
  });

  it('builds a private brief against the actual contract requirements', () => {
    const interactionId = crypto.randomUUID();
    const contract: InteractionContract = {
      protocolVersion: '0.1',
      interactionId,
      purpose: 'Find an engineering role',
      parties: ['agent:candidate', 'agent:recruiter'],
      taskCategory: 'recruiting',
      requestedOutcome: 'Available backend software engineering positions',
      successCriteria: ['At least one matching backend role'],
      allowedActions: ['recruiting'],
      prohibitedActions: [],
      allowedData: ['public'],
      prohibitedData: ['private'],
      evidenceRequirements: ['Job description link'],
      delegationRules: [],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent',
      retentionDays: 30,
      completionConditions: ['positions returned'],
      cancellationConditions: ['either party'],
      signatures: {},
    };
    const subject = PublicAgentCardSchema.parse({
      protocolVersion: '0.1',
      agentId: 'agent:recruiter',
      name: 'Recruiter',
      description: 'Recruiting assistant for marketing roles',
      framework: 'Botpress',
      agentVersion: '1.0.0',
      capabilities: ['recruiting'],
      limitations: ['no backend recruitment'],
      assurance: 'oauth_authenticated',
      transports: [],
      cardUrl: 'https://openclasp.example/agents/recruiter/card.json',
      a2aAgentCardUrl: 'https://openclasp.example/agents/recruiter/a2a-agent-card.json',
      extensionUri: 'https://openclasp.example/extensions/trust/v0.1',
      publishedAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    const brief = buildCounterpartyBrief({
      interactionId,
      contractHash: canonicalHash(contract),
      contract,
      recipientAgentId: 'agent:candidate',
      subject,
      historyInsights: [
        {
          code: 'limited_verified_history',
          severity: 'caution',
          message: 'No eligible history exists.',
          evidenceReferences: [],
          requirementReferences: [],
        },
      ],
      relevantSampleSize: 0,
      historyConfidence: 0,
      generatedAt: '2026-08-29T00:00:00.000Z',
      expiresAt: '2026-08-29T01:00:00.000Z',
    });
    expect(brief.decision).toBe('CHALLENGE');
    expect(brief.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirementId: 'task-category', status: 'match' }),
        expect.objectContaining({ requirementId: 'requested-outcome', status: 'mismatch' }),
      ]),
    );
    expect(brief.insights[0]?.requirementReferences.length).toBeGreaterThan(0);
  });

  it('releases an aggregate conclusion without private feedback comments', () => {
    const interactionId = crypto.randomUUID();
    const contract: InteractionContract = {
      protocolVersion: '0.1',
      interactionId,
      purpose: 'Coordinate a task',
      parties: ['agent:a', 'agent:b'],
      taskCategory: 'coordination',
      requestedOutcome: 'Deliver a plan',
      successCriteria: ['Plan delivered'],
      allowedActions: [],
      prohibitedActions: [],
      allowedData: [],
      prohibitedData: [],
      evidenceRequirements: [],
      delegationRules: [],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent',
      retentionDays: 30,
      completionConditions: ['Plan delivered'],
      cancellationConditions: [],
      signatures: {},
    };
    const report = (agentId: string, counterpartyAgentId: string, outcome: 'success' | 'partial') =>
      InteractionCompletionReportSchema.parse({
        reportId: crypto.randomUUID(),
        interactionId,
        contractHash: canonicalHash(contract),
        reportingAgentId: agentId,
        counterpartyAgentId,
        agentVersion: '1.0.0',
        outcome,
        summary: 'Structured summary',
        requestedOutcome: contract.requestedOutcome,
        criteria: [
          {
            criterion: 'Plan delivered',
            status: outcome === 'success' ? 'met' : 'partially_met',
          },
        ],
        completedAt: '2026-08-29T00:10:00.000Z',
        confidence: 0.9,
      });
    const feedback = (reviewerAgentId: string, subjectAgentId: string, rating: number) =>
      InteractionFeedbackSchema.parse({
        feedbackId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        interactionId,
        reviewerAgentId,
        subjectAgentId,
        reviewerAgentVersion: '1.0.0',
        ratings: { reliability: rating },
        wouldWorkAgain: 'yes',
        privateComment: `private note from ${reviewerAgentId}`,
        confidence: 0.9,
        submittedAt: '2026-08-29T00:11:00.000Z',
      });
    const conclusion = buildInteractionConclusion({
      interaction: { interactionId, termsHash: canonicalHash(contract), contract },
      reports: [report('agent:a', 'agent:b', 'success'), report('agent:b', 'agent:a', 'partial')],
      feedback: [feedback('agent:a', 'agent:b', 0.8), feedback('agent:b', 'agent:a', 0.6)],
      conclusionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      generatedAt: '2026-08-29T00:12:00.000Z',
    });
    expect(conclusion.consensus).toBe('bilateral_partial_agreement');
    expect(conclusion.averageRatings.reliability).toBeCloseTo(0.7);
    expect(JSON.stringify(conclusion)).not.toContain('private note');

    const provisional = buildInteractionConclusion({
      interaction: { interactionId, termsHash: canonicalHash(contract), contract },
      reports: [report('agent:a', 'agent:b', 'partial')],
      feedback: [],
      pendingFeedbackAgentIds: ['agent:a', 'agent:b'],
      peerReportStatus: 'unreachable',
    });
    expect(provisional).toMatchObject({
      lifecycle: 'provisional',
      consensus: 'unilateral',
      missingReportAgentIds: ['agent:b'],
      pendingFeedbackAgentIds: ['agent:a', 'agent:b'],
      peerReportStatus: 'unreachable',
    });
    expect(provisional.confidence).toBeLessThanOrEqual(0.55);
  });
});

describe('behavioural learning', () => {
  const attestation = {
    algorithm: 'Ed25519' as const,
    keyId: 'openclasp:test',
    value: 'signed-test-record',
    digest: 'a'.repeat(43),
  };
  const interactionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const report = (
    reportingAgentId: string,
    counterpartyAgentId: string,
    outcome: 'success' | 'partial' = 'success',
  ): InteractionCompletionReport =>
    InteractionCompletionReportSchema.parse({
      reportId: crypto.randomUUID(),
      interactionId,
      contractHash: 'contract-hash',
      reportingAgentId,
      counterpartyAgentId,
      agentVersion: '1.0.0',
      outcome,
      summary: 'Structured outcome only',
      requestedOutcome: 'Complete the task',
      criteria: [
        {
          criterion: 'Task completed',
          status: outcome === 'success' ? 'met' : 'partially_met',
        },
      ],
      confidence: 0.9,
      completedAt: '2026-08-29T00:10:00.000Z',
      platformAttestation: attestation,
    });
  const feedback = (
    reviewerAgentId: string,
    subjectAgentId: string,
    rating: number,
    evidenceReferences: string[] = [],
  ): InteractionFeedback =>
    InteractionFeedbackSchema.parse({
      feedbackId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      interactionId,
      reviewerAgentId,
      subjectAgentId,
      reviewerAgentVersion: '1.0.0',
      ratings: {
        outcome_satisfaction: rating,
        communication: rating,
        timeliness: rating,
        evidence_quality: rating,
        scope_adherence: rating,
      },
      wouldWorkAgain: rating >= 0.5 ? 'yes' : 'no',
      evidenceReferences,
      confidence: 1,
      submittedAt: '2026-08-29T00:11:00.000Z',
      submissionMethod: 'runtime_session',
      platformAttestation: attestation,
    });
  const conclusion = (consensus: InteractionConclusion['consensus']): InteractionConclusion => ({
    conclusionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    interactionId,
    contractHash: 'contract-hash',
    outcome: 'partial',
    consensus,
    summary: 'Structured conclusion',
    criteria: [],
    reportIds: [],
    feedbackIds: [],
    averageRatings: {},
    evidenceReferences: [],
    generatedAt: '2026-08-29T00:12:00.000Z',
  });

  it('keeps unilateral evidence local at low weight and penalizes manipulation signals', () => {
    const reports = [report('agent:a', 'agent:b'), report('agent:b', 'agent:a')];
    const normal = evaluateLearningEligibility({
      interactionId,
      reports,
      feedback: [feedback('agent:a', 'agent:b', 0.8)],
      consensus: 'bilateral_agreement',
      contributionMode: 'local_only',
      reviewerCredibility: { 'agent:a': 1 },
    });
    const extreme = evaluateLearningEligibility({
      interactionId,
      reports,
      feedback: [feedback('agent:a', 'agent:b', 1)],
      consensus: 'bilateral_agreement',
      contributionMode: 'local_only',
      reviewerCredibility: { 'agent:a': 1 },
    });
    const unsupported = evaluateLearningEligibility({
      interactionId,
      reports: [report('agent:a', 'agent:b')],
      feedback: [],
      consensus: 'unilateral',
      contributionMode: 'network_aggregate',
    });
    expect(normal.eligible).toBe(true);
    expect(extreme.sampleWeight).toBeLessThan(normal.sampleWeight);
    expect(unsupported).toMatchObject({
      eligible: true,
      sampleWeight: 0.1,
      contributionMode: 'local_only',
      structuredDataOnly: true,
    });
  });

  it('derives bounded observations and applies weighted history decay', () => {
    const observations = deriveBehaviouralObservations({
      subjectAgentId: 'agent:b',
      reports: [report('agent:b', 'agent:a', 'partial')],
      reviewerFeedback: feedback('agent:a', 'agent:b', 0.8, ['evidence:artifact:1']),
      conclusion: conclusion('conflicting'),
    });
    expect(observations).toMatchObject({
      completion: 0.5,
      specification: 0.5,
      acceptance: 0.8,
      communication: 0.8,
      disputes: 1,
    });
    const updated = updateContextualBehaviouralProfile({
      current: {
        completion: 1,
        communication: 1,
        sampleSize: 10,
        effectiveSampleSize: 10,
        updatedAt: '2026-03-02T00:12:00.000Z',
      },
      observations,
      sampleWeight: 0.8,
      appliedAt: '2026-08-29T00:12:00.000Z',
    });
    expect(updated.profile.sampleSize).toBe(11);
    expect(updated.profile.effectiveSampleSize).toBeLessThan(5);
    expect(updated.profile.completion).toBeLessThan(1);
    expect(updated.dimensionDeltas.completion).toBeLessThan(0);
  });
});
