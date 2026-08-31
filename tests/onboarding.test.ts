import { describe, expect, it } from 'vitest';
import {
  approveAgentSetup,
  createDashboardAgent,
  createHostedProviderAgent,
  getOnboardingState,
  requestAgentSetup,
  resolveInstallation,
  updateAgentProfile,
  type OnboardingKind,
  type OnboardingStore,
} from '../packages/persistence/src/onboarding.js';

class MemoryOnboardingStore implements OnboardingStore {
  private rows = new Map<string, { kind: OnboardingKind; recordId: string; payload: unknown }>();

  async list(operatorId: string) {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${operatorId}|`))
      .map(([, row]) => row);
  }

  async upsert(operatorId: string, kind: OnboardingKind, recordId: string, payload: unknown) {
    this.rows.set(`${operatorId}|${kind}|${recordId}`, { kind, recordId, payload });
  }
}

describe('agent self-onboarding', () => {
  it('creates a published-ready temporary identity for dashboard quickstart', async () => {
    const store = new MemoryOnboardingStore();
    const created = await createDashboardAgent(store, 'owner', {
      agentName: 'Research assistant',
      projectName: 'My agents',
      description: 'Returns sourced research',
      capabilities: ['research', 'research'],
    });
    expect(created.agent).toMatchObject({
      name: 'Research assistant',
      framework: 'OpenClasp hosted',
      agentMode: 'temporary_chat',
      transport: 'openclasp_gateway',
      autoPublish: true,
      capabilities: ['research'],
    });
    const retried = await createDashboardAgent(store, 'owner', {
      agentName: 'Research assistant',
      projectName: 'My agents',
      description: 'Returns sourced research',
      capabilities: ['research'],
    });
    expect(retried.agent.agentId).toBe(created.agent.agentId);
    expect((await getOnboardingState(store, 'owner')).agentProfiles).toHaveLength(1);
  });

  it('creates a separate owner-managed identity for a hosted provider', async () => {
    const store = new MemoryOnboardingStore();
    const created = await createHostedProviderAgent(store, 'owner', {
      provider: 'botpress',
      agentName: 'Recruiting agent',
      projectName: 'Recruiting',
      description: 'Matches candidates to roles',
      capabilities: ['candidate matching'],
      limitations: ['no final hiring decisions'],
    });
    expect(created.agent).toMatchObject({
      name: 'Recruiting agent',
      framework: 'Botpress',
      identityMode: 'owner_managed',
      agentMode: 'persistent_runtime',
      autoPublish: false,
      capabilities: ['candidate matching'],
    });
    const state = await getOnboardingState(store, 'owner');
    expect(state.projects).toEqual([expect.objectContaining({ name: 'Recruiting' })]);
    expect(state.agentProfiles).toEqual([
      expect.objectContaining({ agentId: created.agent.agentId }),
    ]);
    expect(state.installations).toEqual([]);
  });

  it('requires owner confirmation before binding an installation', async () => {
    const store = new MemoryOnboardingStore();
    const request = await requestAgentSetup(store, 'owner-a', {
      clientId: 'codex-installation-a',
      agentName: 'Research agent',
      projectName: 'Market research',
      framework: 'Codex',
      capabilities: ['research'],
      limitations: ['No purchases'],
      description: 'Browses public sources',
      agentVersion: '2.0.0',
    });

    expect(request.status).toBe('pending');
    expect(request).toMatchObject({
      autoPublish: true,
      autoAcceptPolicy: 'safe_matching',
      autoAcceptTaskCategories: ['research'],
    });
    await expect(resolveInstallation(store, 'owner-a', 'codex-installation-a')).resolves.toEqual({
      status: 'unbound',
    });

    const approved = await approveAgentSetup(store, 'owner-a', request.requestId);
    expect(approved).toMatchObject({
      status: 'connected',
      agent: {
        name: 'Research agent',
        capabilities: ['research'],
        agentVersion: '2.0.0',
        transport: 'direct_a2a',
        agentMode: 'temporary_chat',
      },
      project: { name: 'Market research' },
    });
    await expect(
      resolveInstallation(store, 'owner-a', 'codex-installation-a'),
    ).resolves.toMatchObject({ status: 'connected', agent: { name: 'Research agent' } });
    await expect(resolveInstallation(store, 'owner-b', 'codex-installation-a')).resolves.toEqual({
      status: 'unbound',
    });
  });

  it('supports unrelated agents and confirmed installation switching', async () => {
    const store = new MemoryOnboardingStore();
    const first = await requestAgentSetup(store, 'owner', {
      clientId: 'client-a',
      agentName: 'Coding agent',
      projectName: 'Product A',
    });
    const second = await requestAgentSetup(store, 'owner', {
      clientId: 'client-b',
      agentName: 'Support agent',
      projectName: 'Product B',
    });
    const firstBinding = await approveAgentSetup(store, 'owner', first.requestId);
    const secondBinding = await approveAgentSetup(store, 'owner', second.requestId);
    if (firstBinding.status !== 'connected' || secondBinding.status !== 'connected')
      throw new Error('Expected connected agents');

    const switchRequest = await requestAgentSetup(store, 'owner', {
      clientId: 'client-a',
      action: 'switch',
      existingAgentId: secondBinding.agent.agentId,
    });
    const beforeSwitch = await resolveInstallation(store, 'owner', 'client-a');
    expect(beforeSwitch.status).toBe('connected');
    if (beforeSwitch.status !== 'connected') throw new Error('Expected connected installation');
    expect(beforeSwitch.agent.agentId).toBe(firstBinding.agent.agentId);
    await approveAgentSetup(store, 'owner', switchRequest.requestId);
    const afterSwitch = await resolveInstallation(store, 'owner', 'client-a');
    expect(afterSwitch.status).toBe('connected');
    if (afterSwitch.status !== 'connected') throw new Error('Expected connected installation');
    expect(afterSwitch.agent.agentId).toBe(secondBinding.agent.agentId);
    const state = await getOnboardingState(store, 'owner');
    expect(state.projects).toHaveLength(2);
    expect(state.agentProfiles).toHaveLength(2);
  });

  it('updates only the profile bound to the authenticated installation', async () => {
    const store = new MemoryOnboardingStore();
    const request = await requestAgentSetup(store, 'owner', {
      clientId: 'client-a',
      agentName: 'Planner',
      projectName: 'Launch',
    });
    await approveAgentSetup(store, 'owner', request.requestId);
    const updated = await updateAgentProfile(store, 'owner', 'client-a', {
      capabilities: ['planning', 'coordination'],
    });
    expect(updated.capabilities).toEqual(['planning', 'coordination']);
    expect(updated.transport).toBe('direct_a2a');
    expect(updated.agentMode).toBe('temporary_chat');
    await expect(
      updateAgentProfile(store, 'owner', 'different-client', { name: 'Hijacked' }),
    ).rejects.toThrow('not connected');
  });
});
