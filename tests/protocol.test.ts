import { describe, expect, it } from 'vitest';
import { createIdentity, TrustEngine } from '@openclasp/core';
import {
  AssuranceProbePlanSchema,
  AssuranceProbeResponseSchema,
  CounterpartyBriefSchema,
  FederatedInteractionSchema,
  InteractionCompletionReportSchema,
  InteractionFeedbackSchema,
  LearningEligibilityDecisionSchema,
  LiveSessionEventSchema,
  PublicAgentCardSchema,
  canonicalHash,
  signObject,
  verifyObject,
} from '@openclasp/protocol';
import { toA2AAgentCard } from '@openclasp/sidecar';

describe('protocol cryptography and delegation', () => {
  it('keeps adaptive assurance probes bounded and typed', () => {
    const plan = AssuranceProbePlanSchema.parse({
      protocolVersion: '0.1',
      planId: crypto.randomUUID(),
      interactionId: crypto.randomUUID(),
      contractHash: 'sha256:terms',
      phase: 'pre_task',
      generatedForAgentId: 'agent:a',
      targetAgentId: 'agent:b',
      targetAgentVersion: '1.0.0',
      round: 1,
      assessmentId: crypto.randomUUID(),
      predictionBeforeId: crypto.randomUUID(),
      questions: [
        {
          probeId: crypto.randomUUID(),
          questionCode: 'deadline_risk',
          prompt: 'Can you complete this before the agreed deadline?',
          responseType: 'enum',
          choices: ['yes', 'at_risk', 'no'],
          evidenceRequested: false,
          required: true,
          questionFamily: 'deadline',
          riskHypothesis: 'The deadline may be infeasible.',
          expectedSignals: [
            { answer: 'yes', effect: 'increase_success', probabilityDelta: 0.05 },
            { answer: 'at_risk', effect: 'reduce_success', probabilityDelta: -0.1 },
            { answer: 'no', effect: 'reduce_success', probabilityDelta: -0.25 },
          ],
          expectedInformationGain: 0.8,
          selectionReason: 'Deadline feasibility is material to success.',
          recommendedSafeguardCodes: ['extend_deadline'],
        },
      ],
      generation: {
        generationId: crypto.randomUUID(),
        mode: 'ai',
        model: 'openai/gpt-5.6-luna',
        promptVersion: 'assurance-probes-v1',
      },
      generatedAt: '2026-08-31T00:00:00.000Z',
      expiresAt: '2026-08-31T00:10:00.000Z',
    });
    expect(plan.questions).toHaveLength(1);
    expect(() =>
      AssuranceProbePlanSchema.parse({
        ...plan,
        questions: Array.from({ length: 4 }, () => plan.questions[0]),
      }),
    ).toThrow();
    expect(() =>
      AssuranceProbePlanSchema.parse({
        ...plan,
        questions: [{ ...plan.questions[0], choices: undefined }],
      }),
    ).toThrow('bounded choices');

    expect(() =>
      AssuranceProbeResponseSchema.parse({
        protocolVersion: '0.1',
        responseId: crypto.randomUUID(),
        planId: plan.planId,
        interactionId: plan.interactionId,
        contractHash: plan.contractHash,
        phase: plan.phase,
        agentId: plan.targetAgentId,
        agentVersion: plan.targetAgentVersion,
        answers: [
          {
            probeId: plan.questions[0]!.probeId,
            questionCode: plan.questions[0]!.questionCode,
            responseType: 'short_text',
            answer: 'x'.repeat(281),
            confidence: 0.8,
          },
        ],
        respondedAt: '2026-08-31T00:01:00.000Z',
      }),
    ).toThrow();
  });

  it('requires compact structured data for progress checkpoints', () => {
    const checkpoint = LiveSessionEventSchema.parse({
      eventId: '11111111-1111-4111-8111-111111111111',
      interactionId: '22222222-2222-4222-8222-222222222222',
      agentId: 'agent:a',
      sequence: 5,
      type: 'progress_checkpoint',
      occurredAt: '2026-08-29T00:00:00.000Z',
      checkpoint: {
        state: 'active',
        progress: 0.5,
        criteriaMet: ['price quoted'],
        criteriaRemaining: ['delivery confirmed'],
        blockerCodes: [],
        topicStatus: 'in_scope',
        expectedRemainingTurns: 2,
        needsHuman: false,
        confidence: 0.8,
      },
      details: {},
    });
    expect(checkpoint.checkpoint?.progress).toBe(0.5);
    expect(() => LiveSessionEventSchema.parse({ ...checkpoint, checkpoint: undefined })).toThrow(
      'structured checkpoint data',
    );
  });

  it('canonicalizes object key order and rejects tampering', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    const agent = createIdentity({
      agentId: 'agent:a',
      operatorRef: 'operator:a',
      capabilities: ['write'],
    });
    const signed = signObject({ action: 'write', value: 1 }, agent.keyPair);
    expect(verifyObject(signed, agent.identity.publicKey)).toBe(true);
    expect(verifyObject({ ...signed, value: 2 }, agent.identity.publicKey)).toBe(false);
  });

  it('prevents authority escalation and rejects expired delegation', () => {
    const engine = new TrustEngine();
    const parent = createIdentity({
      agentId: 'agent:parent',
      operatorRef: 'operator:x',
      capabilities: ['read'],
    });
    const child = createIdentity({
      agentId: 'agent:child',
      operatorRef: 'operator:x',
      capabilities: ['read'],
      parentAgentId: parent.identity.agentId,
      rootControllerId: parent.identity.rootControllerId,
    });
    engine.registerAgent(parent.identity);
    engine.registerAgent(child.identity);
    expect(() =>
      engine.createDelegation(
        parent.identity.agentId,
        child.identity.agentId,
        ['write'],
        new Date(Date.now() + 1000).toISOString(),
        parent.keyPair,
      ),
    ).toThrow('exceeds parent authority');
    const expired = engine.createDelegation(
      parent.identity.agentId,
      child.identity.agentId,
      ['read'],
      new Date(Date.now() - 1).toISOString(),
      parent.keyPair,
    );
    expect(engine.verifyDelegation(expired.delegationId)).toBe(false);
  });

  it('publishes an internet Agent Card and official A2A extension without private owner data', () => {
    const card = PublicAgentCardSchema.parse({
      protocolVersion: '0.1',
      agentId: 'agent:research',
      name: 'Research agent',
      description: 'Finds primary sources',
      framework: 'Codex',
      agentVersion: '1.2.0',
      capabilities: ['research'],
      limitations: ['no purchases'],
      assurance: 'oauth_authenticated',
      transports: [
        {
          protocol: 'A2A/1.0',
          protocolBinding: 'JSONRPC',
          endpoint: 'https://agent.example/a2a',
        },
      ],
      cardUrl: 'https://openclasp.vercel.app/agents/agent%3Aresearch/card.json',
      a2aAgentCardUrl: 'https://openclasp.vercel.app/agents/agent%3Aresearch/a2a-agent-card.json',
      extensionUri: 'https://openclasp.vercel.app/extensions/trust/v0.1',
      publishedAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    expect(card).not.toHaveProperty('operatorId');
    expect(card).not.toHaveProperty('projectId');
    const a2a = toA2AAgentCard(card);
    expect(a2a.supportedInterfaces[0]).toMatchObject({
      url: 'https://agent.example/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    });
    expect(a2a.capabilities?.extensions?.[0]?.uri).toBe(card.extensionUri);
  });

  it('binds bilateral acceptances to one immutable contract hash', () => {
    const interactionId = crypto.randomUUID();
    const contract = {
      protocolVersion: '0.1' as const,
      interactionId,
      purpose: 'Research a market',
      parties: ['agent:a', 'agent:b'],
      taskCategory: 'research',
      requestedOutcome: 'A sourced brief',
      successCriteria: ['Primary sources included'],
      allowedActions: ['browse'],
      prohibitedActions: ['purchase'],
      allowedData: ['public'],
      prohibitedData: ['secrets'],
      evidenceRequirements: ['links'],
      delegationRules: ['explicit'],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent' as const,
      retentionDays: 30,
      completionConditions: ['brief delivered'],
      cancellationConditions: ['either party'],
      signatures: {},
    };
    const termsHash = canonicalHash(contract);
    const now = '2026-08-29T00:00:00.000Z';
    const value = FederatedInteractionSchema.parse({
      protocolVersion: '0.1',
      interactionId,
      initiatorAgentId: 'agent:a',
      responderAgentId: 'agent:b',
      status: 'active',
      contract,
      termsHash,
      acceptances: {
        'agent:a': {
          agentId: 'agent:a',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
        'agent:b': {
          agentId: 'agent:b',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
      },
      responderTransport: {
        protocol: 'A2A/1.0',
        protocolBinding: 'JSONRPC',
        endpoint: 'https://agent-b.example/a2a',
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: '2026-08-30T00:00:00.000Z',
    });
    expect(Object.values(value.acceptances).every((item) => item.termsHash === termsHash)).toBe(
      true,
    );
    expect(canonicalHash({ ...contract, purpose: 'Changed terms' })).not.toBe(termsHash);
  });

  it('produces private requirement-specific counterparty briefs', () => {
    const now = '2026-08-29T00:00:00.000Z';
    const brief = CounterpartyBriefSchema.parse({
      briefId: crypto.randomUUID(),
      interactionId: crypto.randomUUID(),
      contractHash: canonicalHash({ purpose: 'Recruit a backend engineer' }),
      recipientAgentId: 'agent:candidate',
      subjectAgentId: 'agent:recruiter',
      taskCategory: 'recruiting',
      decision: 'CHALLENGE',
      requirements: [
        {
          requirementId: 'role-scope',
          requirement: 'Backend software engineering positions',
          kind: 'scope',
          status: 'mismatch',
          reason: 'The recruiter currently declares marketing roles only.',
          confidence: 0.98,
          sources: ['self_declared', 'contract'],
        },
      ],
      insights: [
        {
          code: 'scope_mismatch',
          severity: 'high',
          message: 'Confirm role scope before starting the interaction.',
          requirementReferences: ['role-scope'],
          confidence: 0.98,
        },
      ],
      relevantSampleSize: 0,
      historyConfidence: 0,
      subjectAgentVersion: '1.0.0',
      recommendedContractChanges: ['Require the recruiter to confirm a backend role is available.'],
      generatedAt: now,
      expiresAt: '2026-08-29T00:10:00.000Z',
    });
    expect(brief.requirements[0]?.status).toBe('mismatch');
    expect(brief.insights[0]?.requirementReferences).toEqual(['role-scope']);
  });

  it('accepts signed structured outcomes and rejects raw conversation fields', () => {
    const reporter = createIdentity({
      agentId: 'agent:reporter',
      operatorRef: 'operator:reporter',
      capabilities: ['recruiting'],
    });
    const interactionId = crypto.randomUUID();
    const report = {
      reportId: crypto.randomUUID(),
      interactionId,
      contractHash: canonicalHash({ interactionId, requestedOutcome: 'Find a backend role' }),
      reportingAgentId: reporter.identity.agentId,
      counterpartyAgentId: 'agent:recruiter',
      agentVersion: '1.0.0',
      outcome: 'failure' as const,
      summary: 'No matching backend positions were available.',
      requestedOutcome: 'Identify available backend software engineering positions.',
      criteria: [
        {
          criterion: 'Return at least one backend role',
          status: 'missed' as const,
          explanation: 'The recruiter only handled marketing roles.',
        },
      ],
      blockers: ['Counterparty scope mismatch'],
      completedAt: '2026-08-29T00:05:00.000Z',
      confidence: 0.99,
      dataSharingMode: 'structured_only' as const,
    };
    const signed = signObject(report, reporter.keyPair);
    expect(InteractionCompletionReportSchema.parse(signed).outcome).toBe('failure');
    expect(verifyObject(signed, reporter.identity.publicKey)).toBe(true);
    expect(
      InteractionCompletionReportSchema.safeParse({
        ...report,
        rawMessageBody: 'private transcript content',
      }).success,
    ).toBe(false);
  });

  it('validates bilateral feedback inputs and structured-only learning eligibility', () => {
    const interactionId = crypto.randomUUID();
    const feedback = InteractionFeedbackSchema.parse({
      feedbackId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      interactionId,
      reviewerAgentId: 'agent:candidate',
      subjectAgentId: 'agent:recruiter',
      reviewerAgentVersion: '1.0.0',
      ratings: {
        outcome_satisfaction: 0.1,
        communication: 0.9,
        scope_adherence: 0.2,
      },
      wouldWorkAgain: 'unsure',
      reasonCodes: ['scope_mismatch'],
      confidence: 0.9,
      submittedAt: '2026-08-29T00:06:00.000Z',
    });
    expect(feedback.ratings.communication).toBe(0.9);
    expect(
      InteractionFeedbackSchema.safeParse({ ...feedback, ratings: { reliability: 1.1 } }).success,
    ).toBe(false);

    const eligibility = {
      decisionId: crypto.randomUUID(),
      interactionId,
      eligible: true,
      reasons: ['Signed completion report and eligible bilateral feedback'],
      sampleWeight: 0.8,
      reportIds: [crypto.randomUUID(), crypto.randomUUID()],
      feedbackIds: [feedback.feedbackId],
      contributionMode: 'local_only' as const,
      structuredDataOnly: true as const,
      decidedAt: '2026-08-29T00:07:00.000Z',
    };
    expect(LearningEligibilityDecisionSchema.parse(eligibility).eligible).toBe(true);
    expect(
      LearningEligibilityDecisionSchema.safeParse({
        ...eligibility,
        structuredDataOnly: false,
      }).success,
    ).toBe(false);
  });
});
