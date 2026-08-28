import { describe, expect, it } from 'vitest';
import { createIdentity, TrustEngine } from '@openclasp/core';
import { canonicalHash, signObject, verifyObject } from '@openclasp/protocol';

describe('protocol cryptography and delegation', () => {
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
});
