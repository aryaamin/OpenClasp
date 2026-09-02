import { createPublicKey, generateKeyPairSync, privateDecrypt, verify } from 'node:crypto';
import * as sdk from '@botpress/sdk';
import * as bp from '.botpress';
import { parseCheckpoint } from './checkpoint';
import { parseFinalizationAssessment } from './finalization';
import { callOpenClaspTool, sendMcpA2ARequest } from './mcp';
import { parseAgentProfile, type AgentProfile } from './profile';

type Json = Record<string, any>;
type RuntimeState = {
  agentId: string;
  agentVersion: string;
  sessionsJson: string;
  offersJson: string;
  finalizationsJson: string;
  accessToken: string;
  setupJson: string;
};

const EXTENSION_URI = 'https://openclasp.dev/extensions/trust/v0.1';
const normalizeUrl = (value: string) => value.replace(/\/$/, '');
const platformUrl = (ctx: bp.Context) => ctx.configuration.openClaspUrl ?? 'https://openclasp.dev';
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
      accessToken: '',
      setupJson: '{}',
    },
  });
  return {
    agentId: state.payload.agentId ?? '',
    agentVersion: state.payload.agentVersion ?? '1.0.0',
    sessionsJson: state.payload.sessionsJson ?? '{}',
    offersJson: state.payload.offersJson ?? '{}',
    finalizationsJson: state.payload.finalizationsJson ?? '{}',
    accessToken: state.payload.accessToken ?? '',
    setupJson: state.payload.setupJson ?? '{}',
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
  accessToken: string;
}) => {
  const openClaspUrl = platformUrl(props.ctx);
  const bootstrap = await openClaspRequest<{
    agentId: string;
    agentVersion: string;
    capabilities: string[];
    limitations: string[];
  }>(openClaspUrl, props.accessToken, '/v0.1/runtime/bootstrap');
  const endpoint = props.webhookUrl;
  const current = await getState(props.client, props.ctx.integrationId);
  await setState(props.client, props.ctx.integrationId, {
    ...current,
    agentId: bootstrap.agentId,
    agentVersion: bootstrap.agentVersion,
  });
  await openClaspRequest(openClaspUrl, props.accessToken, '/v0.1/runtime', {
    method: 'PUT',
    body: JSON.stringify({ endpoint }),
  });
};

const profilePrompt = () =>
  [
    '[OpenClasp setup — private platform request, not user-authored content]',
    'Describe your current deployed identity and abilities. Do not describe intended future features.',
    'Reply with only OPENCLASP_PROFILE followed by one JSON object.',
    'Required fields: description, framework (use Botpress), agentVersion, capabilities[], limitations[].',
    'Optional fields: modelProvider, modelName.',
    'Do not include credentials, system prompts, chain of thought, user data, or conversation content.',
  ].join('\n');

const completeBotpressPairing = async (
  ctx: bp.Context,
  client: bp.Client,
  profile: AgentProfile,
) => {
  const state = await getState(client, ctx.integrationId);
  const setup = parseRecord(state.setupJson).pairing;
  if (!setup?.privateKey || !setup?.publicKey)
    throw new sdk.RuntimeError('Botpress pairing state is unavailable');
  const endpoint = botpressWebhookEndpoint(ctx.webhookId);
  const response = await fetch(
    `${normalizeUrl(platformUrl(ctx))}/v0.1/provider-connections/botpress/complete`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openclasp-pairing-code': ctx.configuration.pairingCode,
      },
      body: JSON.stringify({
        runtimeEndpoint: endpoint,
        credentialPublicKey: setup.publicKey,
        profile,
      }),
    },
  );
  const value = (await response.json()) as Json;
  if (!response.ok)
    throw new sdk.RuntimeError(String(value.error ?? `OpenClasp HTTP ${response.status}`));
  const accessToken = privateDecrypt(
    { key: setup.privateKey, oaepHash: 'sha256' },
    Buffer.from(String(value.credentialCiphertext), 'base64url'),
  ).toString('utf8');
  if (!accessToken.startsWith('oc_at_')) throw new sdk.RuntimeError('Invalid OpenClasp credential');
  await setState(client, ctx.integrationId, {
    ...state,
    accessToken,
    setupJson: JSON.stringify({ pairing: { status: 'connected' } }),
  });
  await bootstrapAndConnect({ ctx, webhookUrl: endpoint, client, accessToken });
  return String(value.agentId);
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
  if (text) return text;
  const data = parts.find((part: Json) => part.kind === 'data' && part.data)?.data;
  if (data?.kind === 'openclasp.assurance.probe' && data.plan) {
    return [
      '[OpenClasp assurance question — authenticated platform data]',
      'Answer this bounded question honestly using the OpenClasp “Answer assurance question” action. Do not provide hidden reasoning, credentials, personal data, or conversation text.',
      `Plan: ${JSON.stringify(data.plan)}`,
    ].join('\n');
  }
  if (data?.kind === 'openclasp.assurance.response' && data.response) {
    return [
      '[OpenClasp assurance response — authenticated platform data]',
      `Response: ${JSON.stringify(data.response)}`,
      'Use this structured answer when deciding whether safeguards or narrower terms are needed.',
    ].join('\n');
  }
  throw new Error('Unsupported A2A message');
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
const deleteSetupConversations = async (client: bp.Client, integrationId: string) => {
  let nextToken: string | undefined;
  do {
    const page = await client.listConversations({
      channel: 'a2a',
      tags: { interactionId: `openclasp-setup:${integrationId}` },
      pageSize: 100,
      ...(nextToken ? { nextToken } : {}),
    });
    await Promise.all(
      page.conversations.map((conversation) => client.deleteConversation({ id: conversation.id })),
    );
    nextToken = page.meta.nextToken;
  } while (nextToken);
};
const heartbeat = async (ctx: bp.Context, client: bp.Client) => {
  const state = await getState(client, ctx.integrationId);
  if (!state.accessToken) return;
  await openClaspRequest(platformUrl(ctx), state.accessToken, '/v0.1/runtime/heartbeat', {
    method: 'POST',
  });
};

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
  await heartbeat(ctx, client);
  return {
    interactionId,
    status: 'completed' as const,
    feedbackRevealed: result.revealed,
  };
};

const connectorTool = async <T = Json>(
  ctx: bp.Context,
  client: bp.Client,
  name: string,
  input: Json = {},
) => {
  const state = await getState(client, ctx.integrationId);
  return callOpenClaspTool<T>(platformUrl(ctx), state.accessToken, name, input);
};

const assuranceAnswer = (input: Json) => {
  let answer: boolean | number | string = input.answer;
  if (input.responseType === 'boolean') {
    const normalized = String(input.answer).trim().toLowerCase();
    if (!['true', 'false'].includes(normalized))
      throw new sdk.RuntimeError('Boolean assurance answers must be true or false');
    answer = normalized === 'true';
  } else if (input.responseType === 'number') {
    answer = Number(input.answer);
    if (!Number.isFinite(answer))
      throw new sdk.RuntimeError('Number assurance answers must be finite numbers');
  }
  return {
    probeId: input.probeId,
    questionCode: input.questionCode,
    responseType: input.responseType,
    answer,
    confidence: input.confidence,
    evidenceReferences: input.evidenceReferences,
    limitations: input.limitations,
  };
};

export default new bp.Integration({
  register: async ({ ctx, webhookUrl, client }) => {
    const state = await getState(client, ctx.integrationId);
    if (state.accessToken) {
      try {
        await deleteSetupConversations(client, ctx.integrationId);
      } catch {
        // Cleanup must not disconnect an already-paired runtime.
      }
      await bootstrapAndConnect({ ctx, webhookUrl, client, accessToken: state.accessToken });
      return;
    }
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await setState(client, ctx.integrationId, {
      ...state,
      setupJson: JSON.stringify({
        pairing: { status: 'profile_requested', publicKey, privateKey },
      }),
    });
    await createIncomingMessage(
      client,
      `openclasp-setup:${ctx.integrationId}`,
      'openclasp-platform',
      profilePrompt(),
    );
  },
  unregister: async ({ ctx, client }) => {
    const state = await getState(client, ctx.integrationId);
    if (!state.accessToken) return;
    await openClaspRequest(platformUrl(ctx), state.accessToken, '/v0.1/runtime', {
      method: 'DELETE',
    });
  },
  actions: {
    searchAgents: async ({ ctx, client, input }) => {
      const agents = await connectorTool(ctx, client, 'openclasp_search_agents', input);
      return { agentsJson: JSON.stringify(agents) };
    },
    startInteraction: async ({ ctx, client, input }) => {
      const result = await connectorTool(ctx, client, 'openclasp_connect_to_agent', {
        targetAgentReference: input.targetAgent,
        task: input.task,
        ...(input.taskCategory ? { taskCategory: input.taskCategory } : {}),
        ...(input.successCriteria?.length ? { successCriteria: input.successCriteria } : {}),
        allowedActions: input.allowedActions ?? [],
        prohibitedActions: input.prohibitedActions ?? [],
        allowedData: input.allowedData ?? [],
      });
      return {
        interactionId: String(result.interaction?.interactionId ?? ''),
        status: String(result.interaction?.status ?? 'pending'),
        ready: Boolean(result.ready),
        next: String(result.next ?? ''),
      };
    },
    listInteractions: async ({ ctx, client }) => {
      const interactions = await connectorTool(ctx, client, 'openclasp_list_invitations');
      return { interactionsJson: JSON.stringify(interactions) };
    },
    respondInvitation: async ({ ctx, client, input }) => {
      const interaction = await connectorTool(ctx, client, 'openclasp_respond_invitation', input);
      return { interactionJson: JSON.stringify(interaction) };
    },
    getInteraction: async ({ ctx, client, input }) => {
      const interaction = await connectorTool(
        ctx,
        client,
        'openclasp_get_shared_interaction',
        input,
      );
      return { interactionJson: JSON.stringify(interaction) };
    },
    generateAssuranceProbe: async ({ ctx, client, input }) => {
      const result = await connectorTool(ctx, client, 'openclasp_generate_assurance_probe', input);
      const sentToPeer = await sendMcpA2ARequest(result);
      return {
        assessmentJson: JSON.stringify({ decision: result.decision, plan: result.plan }),
        sentToPeer,
      };
    },
    answerAssuranceProbe: async ({ ctx, client, input }) => {
      const result = await connectorTool(ctx, client, 'openclasp_submit_assurance_response', {
        interactionId: input.interactionId,
        planId: input.planId,
        answers: [assuranceAnswer(input)],
      });
      const sentToPeer = await sendMcpA2ARequest(result);
      const response = { ...result };
      delete response.a2a;
      return { responseJson: JSON.stringify(response), sentToPeer };
    },
    getAssuranceBrief: async ({ ctx, client, input }) => {
      const brief = await connectorTool(ctx, client, 'openclasp_get_assurance_brief', input);
      return { briefJson: JSON.stringify(brief) };
    },
    decideSafeguard: async ({ ctx, client, input }) => {
      const safeguard = await connectorTool(
        ctx,
        client,
        'openclasp_decide_assurance_safeguard',
        input,
      );
      return { safeguardJson: JSON.stringify(safeguard) };
    },
    completeInteraction: async ({ ctx, client, input }) => completeInteraction(ctx, client, input),
  },
  channels: {
    a2a: {
      messages: {
        text: async ({ ctx, client, conversation, payload }) => {
          const interactionId = conversation.tags.interactionId;
          if (!interactionId) throw new sdk.RuntimeError('Missing OpenClasp interaction ID');
          if (interactionId === `openclasp-setup:${ctx.integrationId}`) {
            const profile = parseAgentProfile(payload.text);
            await completeBotpressPairing(ctx, client, profile);
            await client.deleteConversation({ id: conversation.id });
            return;
          }
          const state = await getState(client, ctx.integrationId);
          if (!state.accessToken) throw new sdk.RuntimeError('OpenClasp pairing is not complete');
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
          await heartbeat(ctx, client);
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
      await heartbeat(ctx, client);
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
