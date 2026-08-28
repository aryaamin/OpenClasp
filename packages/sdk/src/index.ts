import {
  canonicalHash,
  signObject,
  type InteractionEvent,
  type KeyPair,
  type TrustEnvelope,
} from '../../protocol/src/index.js';
export { createIdentity } from '../../core/src/index.js';
export * from '../../protocol/src/index.js';

export class OpenClaspClient {
  constructor(readonly baseUrl = 'http://localhost:3100/v0.1') {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
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
