import { describe, expect, it } from 'vitest';
import { createIdentity, FixtureFactCheckProvider, TrustEngine } from '@openclasp/core';
import { createSignedEvent } from '@openclasp/sdk';

describe('general assurance behavior', () => {
  it('does not fact-check opinions as objective truth', async () => {
    const provider = new FixtureFactCheckProvider();
    expect((await provider.check('I think green is the best color')).status).toBe(
      'not_fact_checkable',
    );
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
});
