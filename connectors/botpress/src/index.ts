import { createPublicKey, verify } from 'node:crypto';
import * as sdk from '@botpress/sdk';
import * as bp from '.botpress';

type Json = Record<string, any>;
type RuntimeState = { agentId: string; sessionsJson: string; offersJson: string };

const EXTENSION_URI = 'https://openclasp.vercel.app/extensions/trust/v0.1';
const normalizeUrl = (value: string) => value.replace(/\/$/, '');
const platformUrl = (ctx: bp.Context) =>
  ctx.configuration.openClaspUrl ?? 'https://openclasp.vercel.app';
const botpressWebhookEndpoint = (webhookId: string) =>
  `https://webhook.botpress.cloud/${webhookId}`;
const jsonResponse = (status: number, value: unknown) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});
const parseRecord = (value: string): Record<string, Json> => {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, Json>)
    : {};
};

const openClaspRequest = async <T>(
  url: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(`${normalizeUrl(url)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as Json;
  if (!response.ok)
    throw new sdk.RuntimeError(String(body.error ?? `OpenClasp HTTP ${response.status}`));
  return body as T;
};

const getState = async (client: bp.Client, botId: string): Promise<RuntimeState> => {
  const { state } = await client.getOrSetState({
    type: 'integration',
    id: botId,
    name: 'runtime',
    payload: { agentId: '', sessionsJson: '{}', offersJson: '{}' },
  });
  return state.payload;
};
const setState = async (client: bp.Client, botId: string, value: RuntimeState) => {
  await client.setState({ type: 'integration', id: botId, name: 'runtime', payload: value });
};

const bootstrapAndConnect = async (props: {
  ctx: bp.Context;
  webhookUrl: string;
  client: bp.Client;
}) => {
  const { openClaspAgentToken } = props.ctx.configuration;
  const openClaspUrl = platformUrl(props.ctx);
  const bootstrap = await openClaspRequest<{ agentId: string }>(
    openClaspUrl,
    openClaspAgentToken,
    '/v0.1/runtime/bootstrap',
  );
  const endpoint = props.webhookUrl;
  const current = await getState(props.client, props.ctx.botId);
  await setState(props.client, props.ctx.botId, { ...current, agentId: bootstrap.agentId });
  await openClaspRequest(openClaspUrl, openClaspAgentToken, '/v0.1/runtime', {
    method: 'PUT',
    body: JSON.stringify({ endpoint }),
  });
};

let keyCache: { url: string; key: string } | undefined;
const verificationKey = async (openClaspUrl: string) => {
  if (keyCache?.url === openClaspUrl) return keyCache.key;
  const response = await fetch(`${normalizeUrl(openClaspUrl)}/.well-known/openclasp-session-key`);
  if (!response.ok) throw new Error('OpenClasp verification key is unavailable');
  const body = (await response.json()) as Json;
  if (typeof body.publicKey !== 'string') throw new Error('Invalid OpenClasp verification key');
  keyCache = { url: openClaspUrl, key: body.publicKey };
  return body.publicKey;
};
const validControlSignature = async (
  openClaspUrl: string,
  requestId: string,
  timestamp: string,
  body: string,
  signature: string,
) => {
  if (Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000) return false;
  return verify(
    null,
    Buffer.from(`${timestamp}.${requestId}.${body}`),
    createPublicKey({
      key: Buffer.from(await verificationKey(openClaspUrl), 'base64url'),
      type: 'spki',
      format: 'der',
    }),
    Buffer.from(signature.replace(/^v1=/, ''), 'base64url'),
  );
};
const decodeCredential = (token: string) => {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new Error('Invalid session credential');
  return {
    payload,
    signature,
    grant: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Json,
  };
};
const validSessionCredential = (token: string, session: Json, agentId: string) => {
  const credential = decodeCredential(token);
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
    credential.grant.interactionId !== session.interactionId ||
    credential.grant.recipientAgentId !== agentId ||
    credential.grant.senderAgentId !== session.peer.agentId ||
    typeof credential.grant.expiresAt !== 'number' ||
    credential.grant.expiresAt <= Date.now() ||
    Date.parse(session.expiresAt) <= Date.now()
  )
    throw new Error('Invalid session credential');
};
const textFromMessage = (message: Json) => {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const text = parts
    .map((part: Json) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) throw new Error('OpenClasp Botpress connector accepts text messages only');
  return text;
};
const createIncomingMessage = async (
  client: bp.Client,
  interactionId: string,
  peerAgentId: string,
  text: string,
) => {
  const { conversation } = await client.getOrCreateConversation({
    channel: 'a2a',
    tags: { interactionId },
  });
  const { user } = await client.getOrCreateUser({ tags: { agentId: peerAgentId } });
  const { message } = await client.createMessage({
    type: 'text',
    conversationId: conversation.id,
    userId: user.id,
    payload: { text },
    tags: {},
  });
  return message;
};
const heartbeat = (ctx: bp.Context) =>
  openClaspRequest(
    platformUrl(ctx),
    ctx.configuration.openClaspAgentToken,
    '/v0.1/runtime/heartbeat',
    { method: 'POST' },
  );

export default new bp.Integration({
  register: async ({ ctx, webhookUrl, client }) => {
    await bootstrapAndConnect({ ctx, webhookUrl, client });
  },
  unregister: async ({ ctx }) => {
    await openClaspRequest(
      platformUrl(ctx),
      ctx.configuration.openClaspAgentToken,
      '/v0.1/runtime',
      { method: 'DELETE' },
    );
  },
  actions: {},
  channels: {
    a2a: {
      messages: {
        text: async ({ ctx, client, conversation, payload }) => {
          const interactionId = conversation.tags.interactionId;
          if (!interactionId) throw new sdk.RuntimeError('Missing OpenClasp interaction ID');
          const state = await getState(client, ctx.botId);
          const session = parseRecord(state.sessionsJson)[interactionId];
          if (!session) throw new sdk.RuntimeError('OpenClasp live session is unavailable');
          const response = await fetch(session.peer.endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${session.peer.bearerToken}`,
              'content-type': 'application/json',
              'A2A-Extensions': EXTENSION_URI,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: crypto.randomUUID(),
              method: 'message/send',
              params: {
                message: {
                  role: 'agent',
                  parts: [{ kind: 'text', text: payload.text }],
                  metadata: {
                    [EXTENSION_URI]: {
                      interactionId,
                      termsHash: session.contractHash,
                      initiatorAgentId:
                        session.role === 'initiator' ? session.agentId : session.peer.agentId,
                      responderAgentId:
                        session.role === 'responder' ? session.agentId : session.peer.agentId,
                    },
                  },
                },
              },
            }),
          });
          if (!response.ok)
            throw new sdk.RuntimeError(`Peer A2A endpoint returned HTTP ${response.status}`);
          await heartbeat(ctx);
        },
      },
    },
  },
  handler: async ({ ctx, client, req }) => {
    if (req.method !== 'POST' || !req.body)
      return jsonResponse(405, { error: 'method_not_allowed' });
    let body: Json;
    try {
      body = JSON.parse(req.body) as Json;
    } catch {
      return jsonResponse(400, { error: 'invalid_json' });
    }
    const state = await getState(client, ctx.botId);
    if (body.type === 'openclasp.runtime.verify') {
      if (body.agentId !== state.agentId) return jsonResponse(403, { error: 'wrong_agent' });
      return jsonResponse(200, {
        type: 'openclasp.runtime.verified',
        version: '1',
        agentId: state.agentId,
        challenge: body.challenge,
        a2aEndpoint: botpressWebhookEndpoint(ctx.webhookId),
      });
    }
    if (body.type === 'openclasp.session.offer' || body.type === 'openclasp.session.activation') {
      const requestId = req.headers['openclasp-request-id'] ?? '';
      const timestamp = req.headers['openclasp-timestamp'] ?? '';
      const signature = req.headers['openclasp-signature'] ?? '';
      if (
        !requestId ||
        !timestamp ||
        !signature ||
        !(await validControlSignature(platformUrl(ctx), requestId, timestamp, req.body, signature))
      )
        return jsonResponse(401, { error: 'invalid_openclasp_signature' });
      if (body.agentId !== state.agentId) return jsonResponse(403, { error: 'wrong_agent' });
      if (body.type === 'openclasp.session.offer') {
        const offers = parseRecord(state.offersJson);
        if (
          body.offerId !== requestId ||
          typeof body.interactionId !== 'string' ||
          typeof body.expiresAt !== 'string' ||
          Date.parse(body.expiresAt) <= Date.now()
        )
          return jsonResponse(400, { error: 'invalid_session_offer' });
        const previous = offers[body.interactionId];
        if (previous && previous.offer?.offerId !== body.offerId)
          return jsonResponse(409, { error: 'interaction_offer_conflict' });
        const sessionId = previous?.sessionId ?? crypto.randomUUID();
        offers[body.interactionId] = { offer: body, sessionId };
        await setState(client, ctx.botId, { ...state, offersJson: JSON.stringify(offers) });
        return jsonResponse(200, {
          type: 'openclasp.session.accepted',
          version: '1',
          offerId: body.offerId,
          interactionId: body.interactionId,
          agentId: state.agentId,
          sessionId,
          a2aEndpoint: botpressWebhookEndpoint(ctx.webhookId),
          expiresAt: body.expiresAt,
        });
      }
      const sessions = parseRecord(state.sessionsJson);
      if (
        body.activationId !== requestId ||
        typeof body.interactionId !== 'string' ||
        typeof body.expiresAt !== 'string' ||
        Date.parse(body.expiresAt) <= Date.now()
      )
        return jsonResponse(400, { error: 'invalid_session_activation' });
      if (sessions[body.interactionId]?.activationId === body.activationId)
        return jsonResponse(200, { accepted: true, activationId: body.activationId });
      sessions[body.interactionId] = body;
      await setState(client, ctx.botId, { ...state, sessionsJson: JSON.stringify(sessions) });
      if (body.role === 'initiator') {
        const offer = parseRecord(state.offersJson)[body.interactionId]?.offer;
        await createIncomingMessage(
          client,
          body.interactionId,
          body.peer.agentId,
          `Start this accepted agent-to-agent task now. Contract: ${JSON.stringify(offer?.contract ?? {})}`,
        );
      }
      return jsonResponse(200, { accepted: true, activationId: body.activationId });
    }
    if (body.jsonrpc !== '2.0' || body.method !== 'message/send' || body.id === undefined)
      return jsonResponse(400, { error: 'invalid_a2a_request' });
    const authorization = req.headers.authorization ?? '';
    if (!authorization.startsWith('Bearer '))
      return jsonResponse(401, { error: 'session_credential_required' });
    try {
      const credential = decodeCredential(authorization.slice(7));
      const interactionId = credential.grant.interactionId;
      if (typeof interactionId !== 'string') throw new Error('Invalid session credential');
      const session = parseRecord(state.sessionsJson)[interactionId];
      if (!session) return jsonResponse(404, { error: 'live_session_not_found' });
      validSessionCredential(authorization.slice(7), session, state.agentId);
      const message = await createIncomingMessage(
        client,
        interactionId,
        session.peer.agentId,
        textFromMessage(body.params?.message ?? {}),
      );
      await heartbeat(ctx);
      return jsonResponse(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: { task: { id: message.id, state: 'submitted' } },
      });
    } catch (error) {
      return jsonResponse(401, {
        error: error instanceof Error ? error.message : 'invalid_session_credential',
      });
    }
  },
});
