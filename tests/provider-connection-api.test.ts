import { describe, expect, it } from 'vitest';
import { buildApi } from '../apps/api/src/app.js';

describe('Botpress provider connection API', () => {
  it('issues a pairing code to an owner and accepts an agent-reported profile', async () => {
    const calls: Array<{ name: string; value: unknown }> = [];
    const repository = {
      createProviderConnection: async (owner: string, provider: string, agentName: string) => {
        calls.push({ name: 'create', value: { owner, provider, agentName } });
        return {
          connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          provider,
          agentName,
          status: 'pending',
          code: 'oc_bp_pairing-secret',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
      completeBotpressConnection: async (code: string, value: unknown) => {
        calls.push({ name: 'complete', value: { code, value } });
        return {
          status: 'connected',
          agentId: 'agent-botpress',
          credentialCiphertext: 'encrypted',
        };
      },
    } as any;
    const app = buildApi(undefined, undefined, repository);
    await app.ready();

    const start = await app.inject({
      method: 'POST',
      url: '/v0.1/provider-connections/botpress',
      headers: { 'x-openclasp-operator': 'owner-a' },
      payload: { agentName: 'Purchasing agent' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({ code: 'oc_bp_pairing-secret', status: 'pending' });

    const complete = await app.inject({
      method: 'POST',
      url: '/v0.1/provider-connections/botpress/complete',
      headers: { 'x-openclasp-pairing-code': 'oc_bp_pairing-secret' },
      payload: {
        runtimeEndpoint: 'https://webhook.botpress.cloud/example',
        credentialPublicKey: 'public-key',
        profile: {
          description: 'Compares supplier quotes',
          framework: 'Botpress',
          agentVersion: '1.0.0',
          capabilities: ['compare quotes'],
          limitations: ['human approval before payment'],
        },
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({ status: 'connected', agentId: 'agent-botpress' });
    expect(calls).toHaveLength(2);
    await app.close();
  });
});
