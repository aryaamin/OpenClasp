import { describe, expect, it, vi } from 'vitest';
import {
  resolvePublicRuntimeEndpoint,
  runtimeDeliverySignature,
} from '../packages/persistence/src/runtime.js';
import { createOpenClaspRuntimeHandler, type RuntimeDelivery } from '../packages/sdk/src/index.js';

describe('external agent runtime connector', () => {
  const secret = 'runtime-secret-long-enough-for-testing';

  it('answers endpoint verification and rejects unsigned delivery', async () => {
    const handler = createOpenClaspRuntimeHandler({ signingSecret: secret, onDelivery: vi.fn() });
    const verification = await handler(
      new Request('https://agent.example/openclasp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'openclasp.runtime.verify',
          version: '1',
          agentId: 'agent-b',
          challenge: 'challenge-1',
        }),
      }),
    );
    await expect(verification.json()).resolves.toEqual({
      type: 'openclasp.runtime.verified',
      version: '1',
      agentId: 'agent-b',
      challenge: 'challenge-1',
    });
    const unauthorized = await handler(
      new Request('https://agent.example/openclasp', { method: 'POST', body: '{}' }),
    );
    expect(unauthorized.status).toBe(401);
  });

  it('verifies signed deliveries before invoking the agent runtime', async () => {
    const onDelivery = vi.fn();
    const handler = createOpenClaspRuntimeHandler({ signingSecret: secret, onDelivery });
    const delivery: RuntimeDelivery = {
      type: 'openclasp.a2a.delivery',
      version: '1',
      deliveryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      agentId: 'agent-b',
      interactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      receivedAt: new Date().toISOString(),
      message: {
        messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        senderAgentId: 'agent-a',
        contentType: 'application/json',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: { text: 'hello' },
      },
      reply: {
        endpoint: 'https://openclasp.vercel.app/a2a/agent-a',
        bearerToken: 'scoped-token',
      },
    };
    const body = JSON.stringify(delivery);
    const timestamp = new Date().toISOString();
    const response = await handler(
      new Request('https://agent.example/openclasp', {
        method: 'POST',
        headers: {
          'openclasp-delivery-id': delivery.deliveryId,
          'openclasp-timestamp': timestamp,
          'openclasp-signature': `v1=${runtimeDeliverySignature(secret, delivery.deliveryId, timestamp, body)}`,
        },
        body,
      }),
    );
    expect(response.status).toBe(202);
    expect(onDelivery).toHaveBeenCalledWith(delivery);
  });
});
it('rejects local and non-HTTPS runtime targets before connecting', async () => {
  await expect(resolvePublicRuntimeEndpoint('http://example.com/runtime')).rejects.toThrow('HTTPS');
  await expect(resolvePublicRuntimeEndpoint('https://localhost/runtime')).rejects.toThrow(
    'public DNS',
  );
  await expect(resolvePublicRuntimeEndpoint('https://127.0.0.1/runtime')).rejects.toThrow(
    'public DNS',
  );
});
