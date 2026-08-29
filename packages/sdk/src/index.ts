import {
  canonicalHash,
  signObject,
  type InteractionEvent,
  type KeyPair,
  type TrustEnvelope,
  type FederatedInteraction,
  type PublicAgentCard,
  RuntimeDeliverySchema,
  type RuntimeDelivery,
} from '../../protocol/src/index.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
export { createIdentity } from '../../core/src/index.js';
export * from '../../protocol/src/index.js';

export class OpenClaspClient {
  constructor(
    readonly baseUrl = 'http://localhost:3100/v0.1',
    readonly accessToken?: string,
  ) {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json()) as any;
    if (!response.ok) throw new Error(body.error ?? `OpenClasp request failed: ${response.status}`);
    return body as T;
  }
  registerAgent(identity: unknown) {
    return this.request('/agents', { method: 'POST', body: JSON.stringify(identity) });
  }
  getProfile(agentId: string, version: string, taskCategory: string) {
    return this.request(
      `/profiles/${encodeURIComponent(agentId)}?version=${encodeURIComponent(version)}&taskCategory=${encodeURIComponent(taskCategory)}`,
    );
  }
  saveContract(contract: unknown) {
    return this.request('/interactions/contracts', {
      method: 'POST',
      body: JSON.stringify(contract),
    });
  }
  assess(input: unknown) {
    return this.request('/risk/assess', { method: 'POST', body: JSON.stringify(input) });
  }
  recordEvent(event: unknown) {
    return this.request('/events', { method: 'POST', body: JSON.stringify(event) });
  }
  checkClaim(claim: string) {
    return this.request('/claims/check', { method: 'POST', body: JSON.stringify({ claim }) });
  }
  submitReceipt(receipt: unknown) {
    return this.request('/receipts', { method: 'POST', body: JSON.stringify(receipt) });
  }
  verifyReceipt(receipt: unknown) {
    return this.request('/receipts/verify', { method: 'POST', body: JSON.stringify(receipt) });
  }
  submitFeedback(feedback: unknown) {
    return this.request('/feedback', { method: 'POST', body: JSON.stringify(feedback) });
  }
  setContributionConsent(agentId: string, enabled: boolean) {
    return this.request('/contributions/consent', {
      method: 'POST',
      body: JSON.stringify({ agentId, enabled }),
    });
  }
  getPublicAgentCard(agentId: string): Promise<PublicAgentCard> {
    const root = this.baseUrl.replace(/\/v0\.1\/?$/, '');
    return fetch(`${root}/agents/${encodeURIComponent(agentId)}/card.json`).then(
      async (response) => {
        const body = (await response.json()) as any;
        if (!response.ok)
          throw new Error(body.error ?? `OpenClasp request failed: ${response.status}`);
        return body as PublicAgentCard;
      },
    );
  }
  createFederatedInteraction(value: FederatedInteraction) {
    return this.request<FederatedInteraction>('/federated-interactions', {
      method: 'POST',
      body: JSON.stringify(value),
    });
  }
  listFederatedInteractions() {
    return this.request<FederatedInteraction[]>('/federated-interactions');
  }
  getFederatedInteraction(interactionId: string) {
    return this.request<FederatedInteraction>(
      `/federated-interactions/${encodeURIComponent(interactionId)}`,
    );
  }
  respondToFederatedInteraction(
    interactionId: string,
    agentId: string,
    decision: 'accept' | 'reject',
  ) {
    return this.request<FederatedInteraction>(
      `/federated-interactions/${encodeURIComponent(interactionId)}/respond`,
      { method: 'POST', body: JSON.stringify({ agentId, decision }) },
    );
  }
}

export function createSignedEvent(
  input: Omit<InteractionEvent, 'payloadHash' | 'signature'>,
  key: KeyPair,
): InteractionEvent {
  return signObject(
    { ...input, payloadHash: canonicalHash(input.payload) },
    key,
  ) as InteractionEvent;
}

export function createSignedEnvelope(
  input: Omit<TrustEnvelope, 'signature'>,
  key: KeyPair,
): TrustEnvelope {
  return signObject(input, key) as TrustEnvelope;
}

function validRuntimeSignature(
  secret: string,
  deliveryId: string,
  timestamp: string,
  body: string,
  signature: string,
) {
  if (Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest();
  const actual = Buffer.from(signature.replace(/^v1=/, ''), 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpenClaspRuntimeHandler(input: {
  signingSecret: string;
  onDelivery: (delivery: RuntimeDelivery) => Promise<void> | void;
}) {
  return async (request: Request): Promise<Response> => {
    const body = await request.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (parsed.type === 'openclasp.runtime.verify')
      return Response.json({
        type: 'openclasp.runtime.verified',
        version: '1',
        agentId: parsed.agentId,
        challenge: parsed.challenge,
      });
    const deliveryId = request.headers.get('openclasp-delivery-id') ?? '';
    const timestamp = request.headers.get('openclasp-timestamp') ?? '';
    const signature = request.headers.get('openclasp-signature') ?? '';
    if (
      !deliveryId ||
      !timestamp ||
      !signature ||
      !validRuntimeSignature(input.signingSecret, deliveryId, timestamp, body, signature)
    )
      return Response.json({ error: 'invalid_openclasp_signature' }, { status: 401 });
    const deliveryResult = RuntimeDeliverySchema.safeParse(parsed);
    if (!deliveryResult.success)
      return Response.json({ error: 'invalid_runtime_delivery' }, { status: 400 });
    const delivery = deliveryResult.data;
    if (delivery.deliveryId !== deliveryId)
      return Response.json({ error: 'delivery_id_mismatch' }, { status: 400 });
    await input.onDelivery(delivery);
    return Response.json({ accepted: true, deliveryId }, { status: 202 });
  };
}

export async function sendOpenClaspRuntimeReply(
  delivery: RuntimeDelivery,
  payload: unknown,
  requestId = crypto.randomUUID(),
) {
  const response = await fetch(delivery.reply.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${delivery.reply.bearerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/send',
      params: { message: payload },
    }),
  });
  const result = (await response.json()) as unknown;
  if (!response.ok) throw new Error(`OpenClasp reply failed with HTTP ${response.status}`);
  return result;
}
