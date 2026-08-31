import { describe, expect, it } from 'vitest';
import { canonicalHash, type FederatedInteraction } from '@openclasp/protocol';
import {
  buildPublicAgentCard,
  canAutoAcceptInteraction,
} from '../packages/persistence/src/hosted.js';
import type { AgentProfile } from '../packages/persistence/src/onboarding.js';

function fixture(): { agent: AgentProfile; interaction: FederatedInteraction } {
  const interactionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const contract = {
    protocolVersion: '0.1' as const,
    interactionId,
    purpose: 'Research a competitor',
    parties: ['agent:a', 'agent:b'],
    taskCategory: 'research',
    requestedOutcome: 'A short brief',
    successCriteria: ['Directly answer the task'],
    allowedActions: [],
    prohibitedActions: [],
    allowedData: [],
    prohibitedData: [],
    evidenceRequirements: [],
    delegationRules: ['explicit_contract_scope'],
    humanApprovalRequirements: [],
    factCheckingPolicy: 'important_claims',
    mediationPolicy: 'mutual_consent' as const,
    retentionDays: 30,
    completionConditions: ['Directly answer the task'],
    cancellationConditions: ['either_party_before_completion'],
    signatures: {},
  };
  const termsHash = canonicalHash(contract);
  return {
    agent: {
      agentId: 'agent:b',
      projectId: 'project:b',
      name: 'Research agent',
      description: '',
      framework: 'Codex',
      agentVersion: '1.0.0',
      a2aEndpoint: 'https://agent-b.example/a2a',
      autoPublish: true,
      autoAcceptPolicy: 'safe_matching',
      autoAcceptTaskCategories: ['research'],
      capabilities: ['research'],
      limitations: [],
      identityMode: 'oauth_installation',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    interaction: {
      protocolVersion: '0.1',
      interactionId,
      initiatorAgentId: 'agent:a',
      responderAgentId: 'agent:b',
      status: 'pending',
      contract,
      termsHash,
      acceptances: {
        'agent:a': {
          agentId: 'agent:a',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
      },
      contractRevision: 1,
      contractRevisions: [],
      responderTransport: {
        protocol: 'A2A/1.0',
        protocolBinding: 'JSONRPC',
        endpoint: 'https://agent-b.example/a2a',
        managedBy: 'agent',
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

describe('safe connection automation', () => {
  it('auto-accepts only matching, data-free requests within the owner policy', () => {
    const { agent, interaction } = fixture();
    expect(canAutoAcceptInteraction(agent, interaction)).toBe(true);
    expect(
      canAutoAcceptInteraction(agent, {
        ...interaction,
        contract: { ...interaction.contract, allowedData: ['customer_records'] },
      }),
    ).toBe(false);
    expect(
      canAutoAcceptInteraction(agent, {
        ...interaction,
        contract: { ...interaction.contract, purpose: 'Find a customer access token' },
      }),
    ).toBe(false);
    expect(
      canAutoAcceptInteraction(agent, {
        ...interaction,
        contract: { ...interaction.contract, taskCategory: 'payments' },
      }),
    ).toBe(false);
    expect(canAutoAcceptInteraction({ ...agent, autoAcceptPolicy: 'off' }, interaction)).toBe(
      false,
    );
  });

  it('publishes only an agent-managed runtime endpoint', () => {
    const { agent } = fixture();
    const persistent = buildPublicAgentCard(
      { ...agent, agentMode: 'persistent_runtime' },
      'https://openclasp.example',
    );
    expect(persistent).toMatchObject({
      slug: expect.stringMatching(/^research-agent-/),
      profileUrl: expect.stringContaining('/a/research-agent-'),
      verification: { status: 'verified', method: 'openclasp_oauth_account' },
    });
    expect(persistent.transports[0]).toMatchObject({
      endpoint: 'https://agent-b.example/a2a',
      managedBy: 'agent',
    });
  });
});
