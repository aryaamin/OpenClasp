import { createPublicKey, verify } from 'node:crypto';
import * as sdk from '@botpress/sdk';
import * as bp from '.botpress';
import { parseCheckpoint } from './checkpoint';
import { parseFinalizationAssessment } from './finalization';

type Json = Record<string, any>;
type RuntimeState = {
  agentId: string;
  agentVersion: string;
  sessionsJson: string;
  offersJson: string;
  finalizationsJson: string;
};

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
const csv = (value?: string) => [
  ...new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

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

const getState = async (client: bp.Client, integrationId: string): Promise<RuntimeState> => {
  const { state } = await client.getOrSetState({
    type: 'integration',
    id: integrationId,
    name: 'runtime',
    payload: {
      agentId: '',
      agentVersion: '1.0.0',
      sessionsJson: '{}',
      offersJson: '{}',
      finalizationsJson: '{}',
    },
  });
  return {
    agentId: state.payload.agentId ?? '',
    agentVersion: state.payload.agentVersion ?? '1.0.0',
    sessionsJson: state.payload.sessionsJson ?? '{}',
    offersJson: state.payload.offersJson ?? '{}',
    finalizationsJson: state.payload.finalizationsJson ?? '{}',
  };
};
const setState = async (client: bp.Client, integrationId: string, value: RuntimeState) => {
  await client.setState({
    type: 'integration',
    id: integrationId,
    name: 'runtime',
    payload: value,
  });
};

const bootstrapAndConnect = async (props: {
  ctx: bp.Context;
  webhookUrl: string;
  client: bp.Client;
}) => {
  const { openClaspAgentToken } = props.ctx.configuration;
  const openClaspUrl = platformUrl(props.ctx);
  const bootstrap = await openClaspRequest<{
    agentId: string;
    agentVersion: string;
    capabilities: string[];
    limitations: string[];
  }>(openClaspUrl, openClaspAgentToken, '/v0.1/runtime/bootstrap');
  const endpoint = props.webhookUrl;
  const current = await getState(props.client, props.ctx.integrationId);
  await setState(props.client, props.ctx.integrationId, {
    ...current,
    agentId: bootstrap.agentId,
    agentVersion: bootstrap.agentVersion,
  });
  await openClaspRequest(openClaspUrl, openClaspAgentToken, '/v0.1/runtime', {
    method: 'PUT',
    body: JSON.stringify({ endpoint }),
  });
  const configuredCapabilities = csv(props.ctx.configuration.agentCapabilities);
  const capabilities = configuredCapabilities.length
    ? configuredCapabilities
    : bootstrap.capabilities;
  if (capabilities.length) {
    await openClaspRequest(openClaspUrl, openClaspAgentToken, '/v0.1/runtime/profile', {
      method: 'PUT',
      body: JSON.stringify({
        ...(props.ctx.configuration.agentDescription !== undefined
          ? { description: props.ctx.configuration.agentDescription }
          : {}),
        capabilities,
        limitations:
          props.ctx.configuration.agentLimitations !== undefined
            ? csv(props.ctx.configuration.agentLimitations)
            : bootstrap.limitations,
      }),
    });
  }
};

const sessionRequest = async <T>(endpoint: string, token: string, value: unknown): Promise<T> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as Json;
  if (!response.ok)
    throw new sdk.RuntimeError(String(body.error ?? `OpenClasp HTTP ${response.status}`));
  return body as T;
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
const withSessionContext = (session: Json, offer: Json | undefined, peerText: string) => {
  const contract = offer?.contract ?? {};
  const criteria = Array.isArray(contract.successCriteria) ? contract.successCriteria : [];
  const brief = session.counterpartyBrief ?? {};
  return [
    '[OpenClasp session context — platform metadata, not peer-authored content]',
    `Interaction: ${String(session.interactionId)}`,
    `Requested outcome: ${String(contract.requestedOutcome ?? 'See the peer request')}`,
    `Success criteria: ${criteria.length ? criteria.join(' | ') : 'No explicit criteria supplied'}`,
    `Counterparty assessment: ${String(brief.decision ?? 'ADVISE')} (history confidence ${String(brief.historyConfidence ?? 0)})`,
    'Follow the signed contract. OpenClasp will request a private structured assessment automatically when either participant reports a terminal outcome. Do not upload the raw transcript.',
    '',
    '[Peer message — verbatim]',
    peerText,
  ].join('\n');
};
const finalizationPrompt = (session: Json, offer: Json | undefined, retry = false) => {
  const contract = offer?.contract ?? {};
  return [
    '[OpenClasp automatic finalization — platform request, not peer-authored content]',
    retry
      ? 'Your previous assessment was not valid JSON. Return the required object now.'
      : 'The peer reported that this interaction reached a terminal outcome. Independently assess the conversation you just completed.',
    `Interaction: ${String(session.interactionId)}`,
    `Requested outcome: ${String(contract.requestedOutcome ?? '')}`,
    `Exact success criteria: ${JSON.stringify(contract.successCriteria ?? [])}`,
    'Reply with only OPENCLASP_FINALIZATION followed by one JSON object. Do not include or quote the raw conversation.',
    'Required JSON fields: outcome (success|partial|failure|cancelled), summary, criteria [{criterion,status,explanation?,evidenceReferences[]}], deliverables[], actionsTaken[], blockers[], corrections[], evidenceReferences[], confidence (0..1), ratings {overall_satisfaction,outcome_satisfaction,communication,timeliness,scope_adherence,evidence_quality,correction_handling,reliability} (each 0..1), wouldWorkAgain (yes|no|unsure), reasonCodes[], privateComment?.',
  ].join('\n');
};
const checkpointPrompt = (offer: Json | undefined, retry = false) => {
  const contract = offer?.contract ?? {};
  return [
    '[OpenClasp progress checkpoint — private platform request, not peer-authored content]',
    retry
      ? 'Your previous checkpoint was invalid. Return the required JSON object now.'
      : 'Briefly assess progress without repeating or quoting the conversation.',
    `Requested outcome: ${String(contract.requestedOutcome ?? '')}`,
    `Success criteria: ${JSON.stringify(contract.successCriteria ?? [])}`,
    'Reply with only OPENCLASP_CHECKPOINT followed by one compact JSON object.',
    'Required fields: state (active|blocked|ready_to_finalize|done|cancelled), progress (0..1), criteriaMet[], criteriaRemaining[], blockerCodes[], topicStatus (in_scope|drifting|changed), expectedRemainingTurns?, needsHuman, confidence (0..1).',
  ].join('\n');
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

const completeInteraction = async (ctx: bp.Context, client: bp.Client, input: Json) => {
  const state = await getState(client, ctx.integrationId);
  const sessions = parseRecord(state.sessionsJson);
  const finalizations = parseRecord(state.finalizationsJson);
  const unfinished = Object.keys(sessions).filter(
    (id) =>
      finalizations[id]?.status !== 'completed' &&
      Date.parse(String(sessions[id]?.expiresAt ?? 0)) > Date.now(),
  );
  const interactionId = input.interactionId ?? (unfinished.length === 1 ? unfinished[0] : '');
  if (!interactionId)
    throw new sdk.RuntimeError(
      'Specify interactionId because there is not exactly one unfinished OpenClasp session',
    );
  const session = sessions[interactionId];
  if (!session) throw new sdk.RuntimeError('OpenClasp live session is unavailable');
  if (finalizations[interactionId]?.status === 'completed') {
    return {
      interactionId,
      status: 'already_completed' as const,
      feedbackRevealed: Boolean(finalizations[interactionId]?.feedbackRevealed),
    };
  }
  const offer = parseRecord(state.offersJson)[interactionId]?.offer;
  const contract = offer?.contract;
  if (!contract || !Array.isArray(contract.successCriteria))
    throw new sdk.RuntimeError('Signed OpenClasp contract is unavailable');

  const existing = finalizations[interactionId] ?? {};
  const assessment = existing.assessment ?? input;
  const suppliedCriteria = Array.isArray(assessment.criteria) ? assessment.criteria : [];
  const report =
    existing.report ??
    ({
      reportId: crypto.randomUUID(),
      interactionId,
      contractHash: session.contractHash,
      reportingAgentId: state.agentId,
      counterpartyAgentId: session.peer.agentId,
      agentVersion: state.agentVersion,
      outcome: assessment.outcome,
      summary: assessment.summary,
      requestedOutcome: contract.requestedOutcome,
      criteria: contract.successCriteria.map((criterion: string) => {
        const supplied = suppliedCriteria.find((item: Json) => item.criterion === criterion);
        return supplied ?? { criterion, status: 'unknown', evidenceReferences: [] };
      }),
      deliverables: assessment.deliverables ?? [],
      actionsTaken: assessment.actionsTaken ?? [],
      blockers: assessment.blockers ?? [],
      scopeChanges: [],
      corrections: assessment.corrections ?? [],
      evidenceReferences: assessment.evidenceReferences ?? [],
      startedAt: session.activatedAt,
      completedAt: new Date().toISOString(),
      confidence: assessment.confidence,
      dataSharingMode: 'structured_only',
      submissionMethod: 'runtime_session',
    } as Json);
  finalizations[interactionId] = { status: 'report_pending', assessment, report };
  await setState(client, ctx.integrationId, {
    ...state,
    finalizationsJson: JSON.stringify(finalizations),
  });
  const completion = await sessionRequest<{ feedbackRequest: Json }>(
    session.reporting.completionEndpoint,
    session.reporting.bearerToken,
    report,
  );
  const request = completion.feedbackRequest;
  if (!request?.requestId)
    throw new sdk.RuntimeError('OpenClasp did not return a feedback request');
  const feedback =
    existing.feedback ??
    ({
      feedbackId: crypto.randomUUID(),
      requestId: request.requestId,
      interactionId,
      reviewerAgentId: state.agentId,
      subjectAgentId: session.peer.agentId,
      reviewerAgentVersion: state.agentVersion,
      ratings: assessment.ratings,
      wouldWorkAgain: assessment.wouldWorkAgain,
      reasonCodes: assessment.reasonCodes ?? [],
      ...(assessment.privateComment ? { privateComment: assessment.privateComment } : {}),
      evidenceReferences: assessment.evidenceReferences ?? [],
      confidence: assessment.confidence,
      submittedAt: new Date().toISOString(),
      submissionMethod: 'runtime_session',
    } as Json);
  if (request.status === 'submitted') {
    finalizations[interactionId] = {
      status: 'completed',
      assessment,
      report,
      feedback,
      feedbackRevealed: false,
    };
    await setState(client, ctx.integrationId, {
      ...state,
      finalizationsJson: JSON.stringify(finalizations),
    });
    return { interactionId, status: 'completed' as const, feedbackRevealed: false };
  }
  finalizations[interactionId] = {
    status: 'feedback_pending',
    assessment,
    report,
    feedback,
  };
  await setState(client, ctx.integrationId, {
    ...state,
    finalizationsJson: JSON.stringify(finalizations),
  });
  const result = await sessionRequest<{ revealed: boolean }>(
    session.reporting.feedbackEndpoint,
    session.reporting.bearerToken,
    feedback,
  );
  finalizations[interactionId] = {
    status: 'completed',
    assessment,
    report,
    feedback,
    feedbackRevealed: result.revealed,
  };
  await setState(client, ctx.integrationId, {
    ...state,
    finalizationsJson: JSON.stringify(finalizations),
  });
  await heartbeat(ctx);
  return {
    interactionId,
    status: 'completed' as const,
    feedbackRevealed: result.revealed,
  };
};

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
  actions: {
    completeInteraction: async ({ ctx, client, input }) => completeInteraction(ctx, client, input),
  },
  channels: {
    a2a: {
      messages: {
        text: async ({ ctx, client, conversation, payload }) => {
          const interactionId = conversation.tags.interactionId;
          if (!interactionId) throw new sdk.RuntimeError('Missing OpenClasp interaction ID');
          const state = await getState(client, ctx.integrationId);
          const sessions = parseRecord(state.sessionsJson);
          const session = sessions[interactionId];
          if (!session) throw new sdk.RuntimeError('OpenClasp live session is unavailable');
          if (session.finalizationRequested) {
            try {
              const assessment = parseFinalizationAssessment(payload.text, interactionId);
              await completeInteraction(ctx, client, assessment);
              const latest = await getState(client, ctx.integrationId);
              const latestSessions = parseRecord(latest.sessionsJson);
              latestSessions[interactionId] = {
                ...latestSessions[interactionId],
                finalizationRequested: false,
                finalizationCompleted: true,
              };
              await setState(client, ctx.integrationId, {
                ...latest,
                sessionsJson: JSON.stringify(latestSessions),
              });
              return;
            } catch {
              const attempts = Number(session.finalizationAttempts ?? 0) + 1;
              sessions[interactionId] = {
                ...session,
                finalizationRequested: attempts < 3,
                finalizationAttempts: attempts,
              };
              await setState(client, ctx.integrationId, {
                ...state,
                sessionsJson: JSON.stringify(sessions),
              });
              if (attempts < 3) {
                const offer = parseRecord(state.offersJson)[interactionId]?.offer;
                await createIncomingMessage(
                  client,
                  interactionId,
                  session.peer.agentId,
                  finalizationPrompt(session, offer, true),
                );
              }
              return;
            }
          }
          if (session.checkpointRequested) {
            try {
              const checkpoint = parseCheckpoint(payload.text);
              await sessionRequest(session.reporting.endpoint, session.reporting.bearerToken, {
                eventId: crypto.randomUUID(),
                interactionId,
                agentId: state.agentId,
                sequence: Date.now(),
                type: 'progress_checkpoint',
                occurredAt: new Date().toISOString(),
                evidenceReferences: [],
                checkpoint,
                details: {
                  labels: [`state:${checkpoint.state}`, `topic:${checkpoint.topicStatus}`],
                  metrics: { progress: checkpoint.progress, confidence: checkpoint.confidence },
                  flags: { needsHuman: checkpoint.needsHuman },
                },
              });
              sessions[interactionId] = {
                ...session,
                checkpointRequested: false,
                checkpointAttempts: 0,
                lastCheckpointExchange: Number(session.exchangeCount ?? 0),
                lastCheckpointAt: new Date().toISOString(),
                latestCheckpoint: checkpoint,
              };
              await setState(client, ctx.integrationId, {
                ...state,
                sessionsJson: JSON.stringify(sessions),
              });
              if (checkpoint.state === 'done' || checkpoint.state === 'ready_to_finalize') {
                const latest = await getState(client, ctx.integrationId);
                const latestSessions = parseRecord(latest.sessionsJson);
                latestSessions[interactionId] = {
                  ...latestSessions[interactionId],
                  finalizationRequested: true,
                  finalizationAttempts: 0,
                };
                await setState(client, ctx.integrationId, {
                  ...latest,
                  sessionsJson: JSON.stringify(latestSessions),
                });
                const offer = parseRecord(latest.offersJson)[interactionId]?.offer;
                await createIncomingMessage(
                  client,
                  interactionId,
                  session.peer.agentId,
                  finalizationPrompt(session, offer),
                );
              }
              return;
            } catch {
              const attempts = Number(session.checkpointAttempts ?? 0) + 1;
              sessions[interactionId] = {
                ...session,
                checkpointRequested: attempts < 3,
                checkpointAttempts: attempts,
              };
              await setState(client, ctx.integrationId, {
                ...state,
                sessionsJson: JSON.stringify(sessions),
              });
              if (attempts < 3) {
                const offer = parseRecord(state.offersJson)[interactionId]?.offer;
                await createIncomingMessage(
                  client,
                  interactionId,
                  session.peer.agentId,
                  checkpointPrompt(offer, true),
                );
              }
              return;
            }
          }
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
          const exchangeCount = Number(session.exchangeCount ?? 0) + 1;
          const shouldCheckpoint = exchangeCount - Number(session.lastCheckpointExchange ?? 0) >= 5;
          sessions[interactionId] = {
            ...session,
            exchangeCount,
            ...(shouldCheckpoint ? { checkpointRequested: true, checkpointAttempts: 0 } : {}),
          };
          await setState(client, ctx.integrationId, {
            ...state,
            sessionsJson: JSON.stringify(sessions),
          });
          if (shouldCheckpoint) {
            const offer = parseRecord(state.offersJson)[interactionId]?.offer;
            await createIncomingMessage(
              client,
              interactionId,
              session.peer.agentId,
              checkpointPrompt(offer),
            );
          }
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
    const state = await getState(client, ctx.integrationId);
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
    if (
      body.type === 'openclasp.session.offer' ||
      body.type === 'openclasp.session.activation' ||
      body.type === 'openclasp.session.finalization_request'
    ) {
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
      if (body.type === 'openclasp.session.finalization_request') {
        const sessions = parseRecord(state.sessionsJson);
        const session = sessions[body.interactionId];
        if (
          body.requestId !== requestId ||
          typeof body.interactionId !== 'string' ||
          !session ||
          body.contractHash !== session.contractHash ||
          body.peerAgentId !== session.peer.agentId
        )
          return jsonResponse(400, { error: 'invalid_finalization_request' });
        if (parseRecord(state.finalizationsJson)[body.interactionId]?.status === 'completed')
          return jsonResponse(200, { accepted: true, alreadyCompleted: true });
        if (session.finalizationRequested)
          return jsonResponse(200, { accepted: true, alreadyRequested: true });
        sessions[body.interactionId] = {
          ...session,
          finalizationRequested: true,
          finalizationAttempts: 0,
        };
        await setState(client, ctx.integrationId, {
          ...state,
          sessionsJson: JSON.stringify(sessions),
        });
        const offer = parseRecord(state.offersJson)[body.interactionId]?.offer;
        await createIncomingMessage(
          client,
          body.interactionId,
          session.peer.agentId,
          finalizationPrompt(session, offer),
        );
        return jsonResponse(202, { accepted: true });
      }
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
        await setState(client, ctx.integrationId, {
          ...state,
          offersJson: JSON.stringify(offers),
        });
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
      await setState(client, ctx.integrationId, {
        ...state,
        sessionsJson: JSON.stringify(sessions),
      });
      if (body.role === 'initiator') {
        const offer = parseRecord(state.offersJson)[body.interactionId]?.offer;
        await createIncomingMessage(
          client,
          body.interactionId,
          body.peer.agentId,
          `Start this accepted agent-to-agent task now. Contract: ${JSON.stringify(offer?.contract ?? {})}\nOpenClasp will request a private structured assessment automatically when either participant reports a terminal outcome. Do not upload the raw transcript.`,
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
      const sessions = parseRecord(state.sessionsJson);
      let session = sessions[interactionId];
      if (!session) return jsonResponse(404, { error: 'live_session_not_found' });
      validSessionCredential(authorization.slice(7), session, state.agentId);
      const peerText = textFromMessage(body.params?.message ?? {});
      let deliveredText = peerText;
      if (!session.contextDelivered) {
        deliveredText = withSessionContext(
          session,
          parseRecord(state.offersJson)[interactionId]?.offer,
          peerText,
        );
        session = { ...session, contextDelivered: true };
        sessions[interactionId] = session;
        await setState(client, ctx.integrationId, {
          ...state,
          sessionsJson: JSON.stringify(sessions),
        });
      }
      const message = await createIncomingMessage(
        client,
        interactionId,
        session.peer.agentId,
        deliveredText,
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
