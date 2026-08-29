import {
  DEFAULT_EXTENSION_URI,
  canonicalHash,
  signObject,
  type InteractionEvent,
  type KeyPair,
  type TrustEnvelope,
  type FederatedInteraction,
  LiveSessionActivationSchema,
  LiveSessionEventSchema,
  LiveSessionOfferSchema,
  type LiveSessionActivation,
  type LiveSessionEvent,
  type LiveSessionOffer,
  type PublicAgentCard,
  type HostedThread,
  type HostedMessage,
} from '../../protocol/src/index.js';
import { createPublicKey, verify } from 'node:crypto';
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
  getLiveSession(interactionId: string, agentId: string): Promise<LiveSessionActivation> {
    return this.request(
      `/federated-interactions/${encodeURIComponent(interactionId)}/session?agentId=${encodeURIComponent(agentId)}`,
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
  listHostedThreads(agentId: string): Promise<HostedThread[]> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/threads`);
  }
  getHostedThread(
    agentId: string,
    threadId: string,
  ): Promise<{
    thread: HostedThread;
    messages: HostedMessage[];
    insights: unknown[];
  }> {
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}`,
    );
  }
  sendTemporaryMessage(agentId: string, interactionId: string, content: string) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ interactionId, content }),
    });
  }
  markHostedThreadRead(agentId: string, threadId: string) {
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/read`,
      { method: 'POST' },
    );
  }
  closeHostedThread(agentId: string, threadId: string) {
    return this.request(
      `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/close`,
      { method: 'POST' },
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
  publicKey: string,
  requestId: string,
  timestamp: string,
  body: string,
  signature: string,
) {
  if (Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000) return false;
  return verify(
    null,
    Buffer.from(`${timestamp}.${requestId}.${body}`),
    createPublicKey({ key: Buffer.from(publicKey, 'base64url'), type: 'spki', format: 'der' }),
    Buffer.from(signature.replace(/^v1=/, ''), 'base64url'),
  );
}

export function createOpenClaspRuntimeHandler(input: {
  agentId: string;
  a2aEndpoint: string;
  openClaspUrl?: string;
  openClaspVerificationKey?: string;
  onSessionOffer: (
    offer: LiveSessionOffer,
  ) =>
    Promise<{ accepted: boolean; sessionId?: string }> | { accepted: boolean; sessionId?: string };
  onSessionActivated: (session: LiveSessionActivation) => Promise<void> | void;
  loadSession: (interactionId: string) => Promise<LiveSessionActivation | undefined>;
  onMessage: (input: {
    session: LiveSessionActivation;
    requestId: string | number;
    message: unknown;
  }) => Promise<unknown> | unknown;
}) {
  let verificationKeyPromise: Promise<string> | undefined;
  const verificationKey = () => {
    if (input.openClaspVerificationKey) return Promise.resolve(input.openClaspVerificationKey);
    return (verificationKeyPromise ??= fetch(
      `${(input.openClaspUrl ?? 'https://openclasp.vercel.app').replace(/\/$/, '')}/.well-known/openclasp-session-key`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`OpenClasp key discovery failed: ${response.status}`);
        const value = (await response.json()) as { publicKey?: unknown };
        if (typeof value.publicKey !== 'string')
          throw new Error('Invalid OpenClasp verification key');
        return value.publicKey;
      })
      .catch((error) => {
        verificationKeyPromise = undefined;
        throw error;
      }));
  };
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
        a2aEndpoint: input.a2aEndpoint,
      });
    if (parsed.type !== 'openclasp.session.offer' && parsed.type !== 'openclasp.session.activation')
      return handleDirectMessage(request, parsed, input);
    const requestId = request.headers.get('openclasp-request-id') ?? '';
    const timestamp = request.headers.get('openclasp-timestamp') ?? '';
    const signature = request.headers.get('openclasp-signature') ?? '';
    let signatureValid = false;
    try {
      signatureValid = Boolean(
        requestId &&
        timestamp &&
        signature &&
        validRuntimeSignature(await verificationKey(), requestId, timestamp, body, signature),
      );
    } catch {
      return Response.json({ error: 'openclasp_key_unavailable' }, { status: 503 });
    }
    if (!signatureValid)
      return Response.json({ error: 'invalid_openclasp_signature' }, { status: 401 });
    if (parsed.type === 'openclasp.session.offer') {
      const result = LiveSessionOfferSchema.safeParse(parsed);
      if (
        !result.success ||
        result.data.offerId !== requestId ||
        result.data.agentId !== input.agentId
      )
        return Response.json({ error: 'invalid_session_offer' }, { status: 400 });
      const decision = await input.onSessionOffer(result.data);
      if (!decision.accepted) return Response.json({ error: 'session_declined' }, { status: 409 });
      if (!decision.sessionId)
        return Response.json({ error: 'durable_session_id_required' }, { status: 500 });
      return Response.json({
        type: 'openclasp.session.accepted',
        version: '1',
        offerId: result.data.offerId,
        interactionId: result.data.interactionId,
        agentId: input.agentId,
        sessionId: decision.sessionId,
        a2aEndpoint: input.a2aEndpoint,
        expiresAt: result.data.expiresAt,
      });
    }
    const activation = LiveSessionActivationSchema.safeParse(parsed);
    if (
      !activation.success ||
      activation.data.activationId !== requestId ||
      activation.data.agentId !== input.agentId
    )
      return Response.json({ error: 'invalid_session_activation' }, { status: 400 });
    await input.onSessionActivated(activation.data);
    return Response.json({ accepted: true, activationId: activation.data.activationId });
  };
}

type RuntimeHandlerInput = Parameters<typeof createOpenClaspRuntimeHandler>[0];

function decodeSessionCredential(token: string) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new Error('Invalid live-session credential');
  return {
    payload,
    signature,
    grant: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      interactionId?: unknown;
      senderAgentId?: unknown;
      recipientAgentId?: unknown;
      expiresAt?: unknown;
    },
  };
}

async function handleDirectMessage(
  request: Request,
  parsed: Record<string, unknown>,
  input: RuntimeHandlerInput,
) {
  const rpc = parsed as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (
    rpc.jsonrpc !== '2.0' ||
    (typeof rpc.id !== 'string' && typeof rpc.id !== 'number') ||
    rpc.method !== 'message/send'
  )
    return Response.json({ error: 'invalid_a2a_request' }, { status: 400 });
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer '))
    return Response.json({ error: 'session_credential_required' }, { status: 401 });
  let session: LiveSessionActivation;
  try {
    const credential = decodeSessionCredential(authorization.slice(7));
    if (typeof credential.grant.interactionId !== 'string')
      throw new Error('Invalid interaction credential');
    const loaded = await input.loadSession(credential.grant.interactionId);
    if (!loaded) return Response.json({ error: 'live_session_not_found' }, { status: 404 });
    session = loaded;
    const valid = verify(
      null,
      Buffer.from(credential.payload),
      createPublicKey({
        key: Buffer.from(session.peer.verificationKey, 'base64url'),
        type: 'spki',
        format: 'der',
      }),
      Buffer.from(credential.signature, 'base64url'),
    );
    if (
      !valid ||
      credential.grant.recipientAgentId !== input.agentId ||
      credential.grant.senderAgentId !== session.peer.agentId ||
      typeof credential.grant.expiresAt !== 'number' ||
      credential.grant.expiresAt <= Date.now() ||
      Date.parse(session.expiresAt) <= Date.now()
    )
      return Response.json({ error: 'invalid_session_credential' }, { status: 401 });
  } catch {
    return Response.json({ error: 'invalid_session_credential' }, { status: 401 });
  }
  try {
    const result = await input.onMessage({ session, requestId: rpc.id, message: rpc.params });
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  } catch (error) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -32000, message: error instanceof Error ? error.message : 'Agent failed' },
      },
      { status: 500 },
    );
  }
}

export async function sendOpenClaspDirectMessage(
  session: LiveSessionActivation,
  payload: unknown,
  requestId = crypto.randomUUID(),
) {
  const message =
    payload && typeof payload === 'object'
      ? {
          ...(payload as Record<string, unknown>),
          metadata: {
            ...(((payload as Record<string, unknown>).metadata as Record<string, unknown>) ?? {}),
            [DEFAULT_EXTENSION_URI]: {
              interactionId: session.interactionId,
              termsHash: session.contractHash,
              initiatorAgentId:
                session.role === 'initiator' ? session.agentId : session.peer.agentId,
              responderAgentId:
                session.role === 'responder' ? session.agentId : session.peer.agentId,
            },
          },
        }
      : payload;
  const response = await fetch(session.peer.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.peer.bearerToken}`,
      'content-type': 'application/json',
      'A2A-Extensions': DEFAULT_EXTENSION_URI,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/send',
      params: { message },
    }),
  });
  const result = (await response.json()) as unknown;
  if (!response.ok) throw new Error(`Direct agent request failed with HTTP ${response.status}`);
  return result;
}

export async function reportOpenClaspSessionEvent(
  session: LiveSessionActivation,
  event: LiveSessionEvent,
) {
  const value = LiveSessionEventSchema.parse(event);
  if (value.interactionId !== session.interactionId || value.agentId !== session.agentId)
    throw new Error('Session event does not match the active session');
  const response = await fetch(session.reporting.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.reporting.bearerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  const result = (await response.json()) as unknown;
  if (!response.ok) throw new Error(`OpenClasp event report failed with HTTP ${response.status}`);
  return result;
}
