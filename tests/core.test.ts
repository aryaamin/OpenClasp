import { describe, expect, it } from 'vitest';
import {
  buildCounterpartyBrief,
  createIdentity,
  FixtureFactCheckProvider,
  TrustEngine,
} from '@openclasp/core';
import {
  canonicalHash,
  PublicAgentCardSchema,
  signNamed,
  type InteractionContract,
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
});
