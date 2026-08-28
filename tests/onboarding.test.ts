import { describe, expect, it } from 'vitest';
import {
  approveAgentSetup,
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
  it('requires owner confirmation before binding an installation', async () => {
    const store = new MemoryOnboardingStore();
    const request = await requestAgentSetup(store, 'owner-a', {
      clientId: 'codex-installation-a',
      agentName: 'Research agent',
      projectName: 'Market research',
      framework: 'Codex',
      capabilities: ['research'],
      limitations: ['No purchases'],
    });

    expect(request.status).toBe('pending');
    await expect(resolveInstallation(store, 'owner-a', 'codex-installation-a')).resolves.toEqual({
      status: 'unbound',
    });

    const approved = await approveAgentSetup(store, 'owner-a', request.requestId);
    expect(approved).toMatchObject({
      status: 'connected',
      agent: { name: 'Research agent', capabilities: ['research'] },
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
    await expect(
      updateAgentProfile(store, 'owner', 'different-client', { name: 'Hijacked' }),
    ).rejects.toThrow('not connected');
  });
});
