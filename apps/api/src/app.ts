import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import { z } from 'zod';
import {
  AgentIdentitySchema,
  DelegationCredentialSchema,
  FeedbackSchema,
  InteractionContractSchema,
  InteractionEventSchema,
  ReceiptSchema,
  FederatedInteractionSchema,
  LiveSessionEventSchema,
  InteractionCompletionReportSchema,
  InteractionFeedbackSchema,
  type PublicAgentCard,
} from '../../../packages/protocol/src/index.js';
import {
  MemoryAuditStore,
  TrustEngine,
  UnavailableFactCheckProvider,
} from '../../../packages/core/src/index.js';
import { buildPublicAgentCard } from '../../../packages/persistence/src/index.js';
import type { AgentProfile, HostedRepository } from '../../../packages/persistence/src/index.js';
import { toA2AAgentCard } from '../../../packages/sidecar/src/index.js';
import {
  approveAgentSetup,
  createDashboardAgent,
  createHostedProviderAgent,
  getOnboardingState,
  rejectAgentSetup,
} from '../../../packages/persistence/src/onboarding.js';
import { FixedWindowRateLimiter } from './security.js';
import { renderAgentCardImage } from './agent-card-image.js';

type DashboardRepository = Pick<
  HostedRepository,
  | 'getSettings'
  | 'saveSettings'
  | 'upsert'
  | 'list'
  | 'publishAgent'
  | 'unpublishAgent'
  | 'getPublishedAgent'
  | 'resolveAgentReference'
  | 'searchPublishedAgents'
> & {
  dashboard(operatorId: string): Promise<Record<string, unknown>>;
} & Partial<
    Pick<
      HostedRepository,
      | 'createFederatedInteraction'
      | 'listFederatedInteractions'
      | 'getFederatedInteraction'
      | 'respondToFederatedInteraction'
      | 'proposeContractRevision'
      | 'respondToContractRevision'
      | 'getLiveSession'
      | 'getCounterpartyBrief'
      | 'submitCompletionReport'
      | 'recordSessionCompletionReport'
      | 'submitInteractionFeedback'
      | 'recordSessionFeedback'
      | 'listFeedbackRequests'
      | 'recordLiveSessionEvent'
      | 'touchAgentPresence'
      | 'getRuntimeVerificationKey'
      | 'registerAgentRuntime'
      | 'disableAgentRuntime'
      | 'deleteAgent'
      | 'issueAgentAccessToken'
      | 'listAgentAccessTokens'
      | 'revokeAgentAccessToken'
    >
  > & {
    listContextualIntelligence?: (
      operatorId: string,
      input?: { agentId?: string; taskCategory?: string },
    ) => Promise<any[]>;
    searchPersonalizedMarketplace?: (
      operatorId: string,
      input?: { agentId?: string; taskCategory?: string; query?: string; limit?: number },
    ) => Promise<any[]>;
  };

export function buildApi(
  engine = new TrustEngine(),
  factChecker = new UnavailableFactCheckProvider(),
  repository?: DashboardRepository,
  security: { internalAuthSecret?: string } = {},
) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    requestTimeout: 30_000,
    logger: {
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-openclasp-internal-auth',
        'req.body.rawMessage',
        'req.body.privateKey',
      ],
    },
  });
  const engines = new Map<string, Promise<TrustEngine>>();
  const limiter = new FixedWindowRateLimiter();
  const allowedOrigin = process.env.OPENCLASP_PUBLIC_URL
    ? new URL(process.env.OPENCLASP_PUBLIC_URL).origin
    : undefined;
  void app.register(cors, {
    credentials: Boolean(repository),
    origin(origin, callback) {
      callback(null, !origin || !allowedOrigin || origin === allowedOrigin);
    },
  });
  void app.register(swagger, { openapi: { info: { title: 'OpenClasp API', version: '0.1.0' } } });

  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
    const operator = request.headers['x-openclasp-operator'];
    const bucket = typeof operator === 'string' ? `operator:${operator}` : `ip:${request.ip}`;
    const externalSession = request.url.startsWith('/sessions/') || request.url.startsWith('/a2a/');
    const result = limiter.consume(bucket, externalSession ? 300 : 120, 60_000);
    reply.header('x-ratelimit-remaining', result.remaining);
    if (!result.allowed)
      return reply
        .status(429)
        .header('retry-after', result.retryAfterSeconds)
        .send({ error: 'rate_limit_exceeded' });
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });

  app.setErrorHandler((error, _request, reply) =>
    reply
      .status(
        error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode
          : 400,
      )
      .send({ error: error instanceof Error ? error.message : 'Unknown error' }),
  );
  void app.register(async (router) => {
    const operatorId = (request: { headers: Record<string, unknown> }) => {
      const value = request.headers['x-openclasp-operator'];
      if (
        repository &&
        security.internalAuthSecret &&
        request.headers['x-openclasp-internal-auth'] !== security.internalAuthSecret
      ) {
        const error = new Error('Trusted authentication boundary required');
        Object.assign(error, { statusCode: 401 });
        throw error;
      }
      if (repository && typeof value !== 'string') {
        const error = new Error('Authentication required');
        Object.assign(error, { statusCode: 401 });
        throw error;
      }
      return typeof value === 'string' ? value : undefined;
    };
    const boundAgentId = (request: { headers: Record<string, unknown> }) => {
      const value = request.headers['x-openclasp-bound-agent'];
      if (typeof value !== 'string' || !value) {
        const error = new Error('Agent-bound authentication required');
        Object.assign(error, { statusCode: 401 });
        throw error;
      }
      return value;
    };
    const enforceBoundAgent = (
      request: { headers: Record<string, unknown> },
      requestedAgentId: string,
    ) => {
      const value = request.headers['x-openclasp-bound-agent'];
      if (typeof value === 'string' && value !== requestedAgentId) {
        const error = new Error('Agent credential cannot access another agent');
        Object.assign(error, { statusCode: 403 });
        throw error;
      }
    };
    const scopedEngine = async (request: { headers: Record<string, unknown> }) => {
      const owner = operatorId(request);
      if (!repository || !owner) return engine;
      let pending = engines.get(owner);
      if (!pending) {
        pending = repository.list(owner).then((rows) => {
          const store = new MemoryAuditStore();
          for (const row of rows) {
            if (row.kind !== 'interaction') store.append(row.kind, row.recordId, row.payload);
          }
          return new TrustEngine(store);
        });
        engines.set(owner, pending);
      }
      return pending;
    };
    const persist = async (
      request: { headers: Record<string, unknown> },
      kind: Parameters<HostedRepository['upsert']>[1],
      id: string,
      value: unknown,
    ) => {
      const owner = operatorId(request);
      if (repository && owner) await repository.upsert(owner, kind, id, value);
    };
    const publicBaseUrl = (request: { headers: Record<string, unknown> }) => {
      const forwardedHost = request.headers['x-forwarded-host'];
      const host = typeof forwardedHost === 'string' ? forwardedHost : request.headers.host;
      const forwardedProtocol = request.headers['x-forwarded-proto'];
      const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol : 'https';
      return process.env.OPENCLASP_PUBLIC_URL ?? `${protocol}://${String(host ?? 'localhost')}`;
    };
    const publicPublication = (card: PublicAgentCard) => ({
      agentId: card.agentId,
      published: true,
      profileUrl: card.profileUrl,
      cardUrl: card.cardUrl,
      a2aAgentCardUrl: card.a2aAgentCardUrl,
      verification: card.verification,
      updatedAt: card.updatedAt,
    });
    const escapeHtml = (value: string) =>
      value.replace(/[&<>"']/g, (character) => {
        const entities: Record<string, string> = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        };
        return entities[character]!;
      });
    router.get('/health', async () => ({ status: 'ok' }));
    router.get('/ready', async () => ({ status: 'ready' }));
    router.get('/openapi.json', async () => app.swagger());
    router.get('/.well-known/openclasp-session-key', async () => {
      if (!repository?.getRuntimeVerificationKey)
        throw new Error('Runtime verification is not configured');
      return repository.getRuntimeVerificationKey();
    });
    router.get('/extensions/trust/v0.1', async () => ({
      uri: 'https://openclasp.vercel.app/extensions/trust/v0.1',
      name: 'OpenClasp A2A assurance extension',
      version: '0.1',
      required: false,
      transportsMessages: false,
      documentation: 'https://github.com/aryaamin/OpenClasp/blob/main/docs/A2A_EXTENSION.md',
    }));
    router.post('/sessions/:id/events', async (request, reply) => {
      if (!repository?.recordLiveSessionEvent)
        throw new Error('Live-session reporting is not configured');
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) {
        reply.status(401);
        return { error: 'session_credential_required' };
      }
      const event = LiveSessionEventSchema.parse(request.body);
      if (event.interactionId !== (request.params as { id: string }).id)
        throw new Error('Interaction path does not match the event');
      return repository.recordLiveSessionEvent(authorization.slice(7), event);
    });
    router.post('/sessions/:id/completion-reports', async (request, reply) => {
      if (!repository?.recordSessionCompletionReport)
        throw new Error('Live-session completion reporting is not configured');
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) {
        reply.status(401);
        return { error: 'session_credential_required' };
      }
      const report = InteractionCompletionReportSchema.parse(request.body);
      if (report.interactionId !== (request.params as { id: string }).id)
        throw new Error('Interaction path does not match the completion report');
      return repository.recordSessionCompletionReport(authorization.slice(7), report);
    });
    router.post('/sessions/:id/feedback', async (request, reply) => {
      if (!repository?.recordSessionFeedback)
        throw new Error('Live-session feedback is not configured');
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) {
        reply.status(401);
        return { error: 'session_credential_required' };
      }
      const feedback = InteractionFeedbackSchema.parse(request.body);
      if (feedback.interactionId !== (request.params as { id: string }).id)
        throw new Error('Interaction path does not match the feedback');
      return repository.recordSessionFeedback(authorization.slice(7), feedback);
    });
    router.get('/agents/:id/card.json', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return card;
    });
    router.get('/agents/:id/.well-known/openclasp-agent.json', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return card;
    });
    router.get('/agents/:id/a2a-agent-card.json', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      if (!card.transports.length) throw new Error('Agent has not published an A2A endpoint');
      return toA2AAgentCard(card);
    });
    router.get('/agents/:id/og.png', async (request, reply) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return reply
        .type('image/png')
        .header('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800')
        .send(await renderAgentCardImage(card));
    });
    router.get('/directory/resolve', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const { reference } = z
        .object({ reference: z.string().min(1).max(2048) })
        .parse(request.query);
      const result = await repository.resolveAgentReference(reference);
      if (!result) throw new Error('Published agent not found');
      return result;
    });
    router.get('/directory/search', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const input = z
        .object({
          query: z.string().trim().max(100).optional(),
          capability: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .parse(request.query);
      return repository.searchPublishedAgents(input);
    });
    router.get('/a/:reference', async (request, reply) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const result = await repository.resolveAgentReference(
        (request.params as { reference: string }).reference,
      );
      if (!result) throw new Error('Published agent not found');
      const { card } = result;
      const socialImageUrl = `${publicBaseUrl(request)}/agents/${encodeURIComponent(card.agentId)}/og.png`;
      const capabilities = card.capabilities
        .map((capability) => `<li>${escapeHtml(capability)}</li>`)
        .join('');
      const limitations = card.limitations
        .map((limitation) => `<li>${escapeHtml(limitation)}</li>`)
        .join('');
      const runtimeLabel = 'Agent-owned cloud runtime';
      const presence = card.presence?.status ?? 'offline';
      const structured = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: card.name,
        description: card.description,
        url: card.profileUrl,
      }).replace(/</g, '\\u003c');
      return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(card.name)} · OpenClasp</title><meta name="description" content="${escapeHtml(card.description)}">
<link rel="canonical" href="${escapeHtml(card.profileUrl ?? card.cardUrl)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(card.profileUrl ?? card.cardUrl)}">
<meta property="og:title" content="${escapeHtml(card.name)} · OpenClasp agent profile"><meta property="og:description" content="${escapeHtml(card.description)}"><meta property="og:image" content="${escapeHtml(socialImageUrl)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(`${card.name} Agent Card`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(card.name)} · OpenClasp agent profile"><meta name="twitter:description" content="${escapeHtml(card.description)}"><meta name="twitter:image" content="${escapeHtml(socialImageUrl)}">
<meta name="theme-color" content="#100b0a"><meta property="og:site_name" content="OpenClasp">
<style>color-scheme:dark;*{box-sizing:border-box}html{background:#0b0909}body{margin:0;color:#f8f3f0;background:radial-gradient(circle at 78% 8%,rgba(240,75,45,.18),transparent 30rem),linear-gradient(145deg,#090808 0%,#120d0c 56%,#1f0e0b 100%);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}a{color:inherit;text-decoration:none}.shell{width:min(1180px,calc(100% - 40px));margin:auto}.topbar{height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.09)}.brand{display:flex;align-items:center;gap:11px;font-weight:760;letter-spacing:-.02em}.brand-mark{position:relative;width:26px;height:20px;background:#f04b2d;clip-path:polygon(24% 0,76% 0,100% 50%,76% 100%,24% 100%,0 50%)}.brand-mark:after{content:"";position:absolute;inset:4px;background:#0d0909;clip-path:inherit}.top-cta,.primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;background:#f04b2d;color:#fff;font-weight:700;transition:transform .16s ease,background .16s ease}.top-cta{min-height:38px;padding:0 16px;font-size:13px}.top-cta:hover,.primary:hover{background:#ff6245;transform:translateY(-1px)}main{padding:64px 0 48px}.hero{display:grid;grid-template-columns:minmax(0,.86fr) minmax(470px,1.14fr);align-items:center;gap:clamp(42px,7vw,92px);min-height:570px}.eyebrow{margin:0 0 18px;color:#f87358;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.17em;text-transform:uppercase}.badges{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:26px}.badge{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid rgba(255,255,255,.13);border-radius:999px;color:#b9aca6;background:rgba(255,255,255,.035);font-size:11px;font-weight:650}.badge.verified{border-color:rgba(68,211,126,.44);color:#5ce090;background:rgba(68,211,126,.07)}.badge.verified:before{content:"✓"}.badge.status:before{width:6px;height:6px;border-radius:50%;background:#766b67;content:""}.badge.status.online{color:#5ce090}.badge.status.online:before{background:#44d37e;box-shadow:0 0 0 4px rgba(68,211,126,.12)}h1{max-width:11ch;margin:0;font-size:clamp(48px,6vw,78px);line-height:.96;letter-spacing:-.065em}h1 span{color:#f87358}.lead{max-width:580px;margin:26px 0 0;color:#b9ada7;font-size:clamp(17px,2vw,21px);line-height:1.55}.facts{display:flex;flex-wrap:wrap;gap:9px 22px;margin:28px 0;color:#887d78;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.facts b{color:#d3c9c4;font-weight:600}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px}.primary,.secondary{min-height:48px;padding:0 19px}.secondary{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.15);border-radius:999px;color:#d8cfca;background:rgba(255,255,255,.035);font-weight:700}.secondary:hover{border-color:rgba(240,75,45,.6);color:#fff}.verification-note{max-width:540px;margin:18px 0 0;color:#766c67;font-size:11px}.share-preview{overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:rgba(10,8,8,.78);box-shadow:0 34px 100px rgba(0,0,0,.42);transform:rotate(1deg);transition:transform .3s ease,border-color .3s ease}.share-preview:hover{border-color:rgba(240,75,45,.5);transform:rotate(0) translateY(-4px)}.preview-head{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid rgba(255,255,255,.09);color:#887d78;font:650 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase}.preview-head a{color:#f87358}.share-preview img{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:cover}.preview-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0;padding:14px 16px;color:#887d78;font-size:11px}.preview-foot strong{color:#d8cfca}.details{display:grid;grid-template-columns:1fr 1fr .9fr;margin:52px 0 0;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:rgba(8,7,7,.38)}.detail{min-height:250px;padding:28px}.detail+.detail{border-left:1px solid rgba(255,255,255,.1)}.detail h2{margin:0 0 20px;color:#8f837e;font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;text-transform:uppercase}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}.chips li{padding:8px 10px;border:1px solid rgba(255,255,255,.11);border-radius:8px;color:#d4cac5;background:rgba(255,255,255,.035);font-size:12px}.limits{display:grid;gap:12px;margin:0;padding:0;list-style:none;color:#aaa09a}.limits li{display:flex;gap:9px}.limits li:before{color:#f87358;content:"—"}.machine{background:linear-gradient(155deg,rgba(240,75,45,.09),transparent 70%)}.machine code{display:block;overflow-wrap:anywhere;color:#887d78;font:11px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}.machine-links{display:grid;gap:9px;margin-top:21px}.machine-links a{display:flex;justify-content:space-between;padding-top:9px;border-top:1px solid rgba(255,255,255,.08);color:#f87358;font-size:12px;font-weight:700}.join{display:flex;align-items:center;justify-content:space-between;gap:30px;margin:52px 0 0;padding:34px 38px;border:1px solid rgba(240,75,45,.35);border-radius:20px;background:linear-gradient(110deg,rgba(240,75,45,.13),rgba(240,75,45,.03))}.join p{margin:5px 0 0;color:#958984}.join h2{margin:0;font-size:24px;letter-spacing:-.035em}.footer{display:flex;align-items:center;justify-content:space-between;min-height:86px;border-top:1px solid rgba(255,255,255,.09);color:#746a66;font-size:11px}.footer a{color:#a99e99}@media(max-width:900px){.hero{grid-template-columns:1fr;min-height:auto}.hero-copy{max-width:700px}.share-preview{max-width:720px;transform:none}.details{grid-template-columns:1fr 1fr}.detail.machine{grid-column:1/-1;border-left:0;border-top:1px solid rgba(255,255,255,.1)}}@media(max-width:620px){.shell{width:min(100% - 24px,1180px)}.topbar{height:62px}.top-cta{padding:0 12px;font-size:11px}main{padding-top:42px}.hero{gap:34px}h1{font-size:46px}.lead{font-size:16px}.details{grid-template-columns:1fr}.detail{min-height:0}.detail+.detail,.detail.machine{grid-column:auto;border-left:0;border-top:1px solid rgba(255,255,255,.1)}.join{display:grid;padding:26px}.join .primary{width:100%}.footer{align-items:flex-start;flex-direction:column;justify-content:center;gap:5px}.preview-foot{align-items:flex-start;flex-direction:column}}</style>
<script type="application/ld+json">${structured}</script></head><body><div class="shell"><header class="topbar"><a class="brand" href="/" aria-label="OpenClasp home"><span class="brand-mark" aria-hidden="true"></span><span>OpenClasp</span></a><a class="top-cta" href="/login">Create your card <span aria-hidden="true">→</span></a></header>
<main><section class="hero"><div class="hero-copy"><p class="eyebrow">Public agent profile</p><div class="badges"><span class="badge verified">Publisher verified</span><span class="badge status ${presence === 'online' ? 'online' : ''}">${escapeHtml(presence)}</span><span class="badge">${escapeHtml(runtimeLabel)}</span></div><h1>${escapeHtml(card.name)}<span>.</span></h1><p class="lead">${escapeHtml(card.description || 'Public agent identity on OpenClasp.')}</p><div class="facts"><span>Framework <b>${escapeHtml(card.framework)}</b></span><span>Version <b>${escapeHtml(card.agentVersion)}</b></span><span>Protocol <b>A2A/1.0</b></span></div><div class="actions"><a class="primary" href="/login">Add your agent — free <span aria-hidden="true">→</span></a><a class="secondary" href="${escapeHtml(card.a2aAgentCardUrl)}">Open A2A card</a></div><p class="verification-note">OpenClasp verified control of the publishing account. Capabilities and limitations are declared by the publisher.</p></div>
<aside class="share-preview"><div class="preview-head"><span>Share-ready Agent Card</span><a href="${escapeHtml(socialImageUrl)}" download>Download PNG</a></div><img src="${escapeHtml(socialImageUrl)}" width="1200" height="630" alt="Share card for ${escapeHtml(card.name)}"><p class="preview-foot"><strong>Paste this profile anywhere.</strong><span>OpenGraph preview included automatically.</span></p></aside></section>
<section class="details"><article class="detail"><h2>What this agent does</h2><ul class="chips">${capabilities || '<li>No capabilities published</li>'}</ul></article><article class="detail"><h2>Declared limitations</h2><ul class="limits">${limitations || '<li>No limitations published</li>'}</ul></article><article class="detail machine"><h2>For agents and developers</h2><code>${escapeHtml(card.agentId)}</code><div class="machine-links"><a href="${escapeHtml(card.cardUrl)}"><span>OpenClasp JSON</span><span aria-hidden="true">↗</span></a><a href="${escapeHtml(card.a2aAgentCardUrl)}"><span>A2A Agent Card</span><span aria-hidden="true">↗</span></a></div></article></section>
<section class="join"><div><h2>Give your agent a shareable identity.</h2><p>Publish a verified Agent Card and make it discoverable to other cloud agents.</p></div><a class="primary" href="/login">Create yours — free <span aria-hidden="true">→</span></a></section></main><footer class="footer"><span>OpenClasp · identity and behavioural intelligence for AI agents</span><a href="/">openclasp.dev</a></footer></div></body></html>`);
    });
    router.get('/v0.1/dashboard', async (request) => {
      const owner = operatorId(request);
      if (repository && owner) return repository.dashboard(owner);
      return {
        agents: [...engine.agents.values()],
        projects: [],
        installations: [],
        setupRequests: [],
        publications: [],
        interactions: [],
        federatedInteractions: [],
        liveSessions: [],
        events: [...engine.events.values()],
        conflicts: [...engine.conflicts.values()],
        receipts: [...engine.receipts.values()],
        profiles: [...engine.profiles.values()],
        counterpartyBriefs: [],
        completionReports: [],
        feedbackRequests: [],
        interactionFeedback: [],
        interactionConclusions: [],
        learningEligibility: [],
        profileDeltas: [],
        intelligenceSummaries: [],
        runtimes: [],
      };
    });
    router.get('/v0.1/intelligence', async (request) => {
      const owner = operatorId(request);
      if (!repository?.listContextualIntelligence || !owner)
        throw new Error('Contextual intelligence is not configured');
      const input = z
        .object({
          agentId: z.string().min(1).optional(),
          taskCategory: z.string().trim().min(1).max(100).optional(),
        })
        .parse(request.query);
      return repository.listContextualIntelligence(owner, {
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.taskCategory ? { taskCategory: input.taskCategory } : {}),
      });
    });
    router.get('/v0.1/marketplace', async (request) => {
      const owner = operatorId(request);
      if (!repository?.searchPersonalizedMarketplace || !owner)
        throw new Error('Personalized marketplace is not configured');
      const input = z
        .object({
          agentId: z.string().min(1).optional(),
          taskCategory: z.string().trim().min(1).max(100).optional(),
          query: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(30),
        })
        .parse(request.query);
      const results = await repository.searchPersonalizedMarketplace(owner, {
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.taskCategory ? { taskCategory: input.taskCategory } : {}),
        ...(input.query ? { query: input.query } : {}),
        limit: input.limit,
      });
      return results.filter(
        (result) =>
          result.card.agentMode === 'persistent_runtime' &&
          result.card.transports.some(
            (transport: { managedBy?: string }) => transport.managedBy === 'agent',
          ),
      );
    });
    router.get('/v0.1/account', async (request) => {
      const owner = operatorId(request);
      return {
        operatorId: owner,
        email: decodeURIComponent(String(request.headers['x-openclasp-email'] ?? '')),
        name: decodeURIComponent(String(request.headers['x-openclasp-name'] ?? '')),
      };
    });
    router.get('/v0.1/settings', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner)
        return {
          displayName: '',
          contributionEnabled: false,
          rawConversationsStored: false,
        };
      return repository.getSettings(owner);
    });
    router.get('/v0.1/onboarding', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      return getOnboardingState(repository, owner);
    });
    router.get('/v0.1/runtime/bootstrap', async (request) => {
      const owner = operatorId(request);
      const agentId = boundAgentId(request);
      const rows = owner && repository ? await repository.list(owner) : [];
      const profile = rows.find((row) => row.kind === 'agent_profile' && row.recordId === agentId)
        ?.payload as AgentProfile | undefined;
      return {
        agentId,
        agentVersion: profile?.agentVersion ?? '1.0.0',
        capabilities: profile?.capabilities ?? [],
        limitations: profile?.limitations ?? [],
        openClaspUrl: publicBaseUrl(request),
        runtimeRegistrationEndpoint: `${publicBaseUrl(request)}/v0.1/runtime`,
        protocol: 'A2A/1.0',
        controlProtocol: 'OpenClasp/0.1',
      };
    });
    router.put('/v0.1/runtime', async (request) => {
      const owner = operatorId(request);
      if (!repository?.registerAgentRuntime || !owner)
        throw new Error('Hosted runtime delivery is not configured');
      const endpoint = z
        .object({ endpoint: z.string().url().max(2048) })
        .parse(request.body).endpoint;
      return repository.registerAgentRuntime(owner, boundAgentId(request), endpoint);
    });
    router.delete('/v0.1/runtime', async (request) => {
      const owner = operatorId(request);
      if (!repository?.disableAgentRuntime || !owner)
        throw new Error('Hosted runtime delivery is not configured');
      return repository.disableAgentRuntime(owner, boundAgentId(request));
    });
    router.post('/v0.1/runtime/heartbeat', async (request) => {
      const owner = operatorId(request);
      if (!repository?.touchAgentPresence || !owner)
        throw new Error('Agent presence is not configured');
      return repository.touchAgentPresence(owner, boundAgentId(request));
    });
    router.put('/v0.1/runtime/profile', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const agentId = boundAgentId(request);
      const value = z
        .object({
          description: z.string().trim().max(500).optional(),
          capabilities: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
          limitations: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
        })
        .strict()
        .parse(request.body);
      const rows = await repository.list(owner);
      const current = rows.find((row) => row.kind === 'agent_profile' && row.recordId === agentId)
        ?.payload as AgentProfile | undefined;
      if (!current || current.status !== 'active') throw new Error('Active owned agent not found');
      const profile: AgentProfile = {
        ...current,
        ...(value.description !== undefined ? { description: value.description } : {}),
        capabilities: [...new Set(value.capabilities)],
        limitations: [...new Set(value.limitations)],
        updatedAt: new Date().toISOString(),
      };
      await repository.upsert(owner, 'agent_profile', agentId, profile);
      const publication = rows.find((row) => row.kind === 'publication' && row.recordId === agentId)
        ?.payload as { published?: boolean } | undefined;
      if (profile.autoPublish || publication?.published) {
        const previous = await repository.getPublishedAgent(agentId);
        const card = await repository.publishAgent(
          owner,
          buildPublicAgentCard(profile, publicBaseUrl(request), previous),
        );
        await repository.upsert(owner, 'publication', agentId, publicPublication(card));
        return { profile, card };
      }
      return { profile };
    });
    router.post('/v0.1/onboarding/:id/approve', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const requestId = (request.params as { id: string }).id;
      const state = await getOnboardingState(repository, owner);
      const setup = state.setupRequests.find((item) => item.requestId === requestId);
      const result = await approveAgentSetup(repository, owner, requestId);
      if (result.status === 'connected' && setup?.autoPublish) {
        const previous = await repository.getPublishedAgent(result.agent.agentId);
        const card = await repository.publishAgent(
          owner,
          buildPublicAgentCard(result.agent, publicBaseUrl(request), previous),
        );
        await repository.upsert(
          owner,
          'publication',
          result.agent.agentId,
          publicPublication(card),
        );
      }
      return result;
    });
    router.post('/v0.1/onboarding/:id/reject', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      return rejectAgentSetup(repository, owner, (request.params as { id: string }).id);
    });
    router.put('/v0.1/settings', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const value = z
        .object({
          displayName: z.string().trim().max(100),
          contributionEnabled: z.boolean(),
        })
        .parse(request.body);
      return repository.saveSettings(owner, value);
    });
    router.post('/v0.1/provider-connections', async (request) => {
      const owner = operatorId(request);
      if (!repository?.issueAgentAccessToken || !owner)
        throw new Error('Hosted provider connections are not configured');
      const value = z
        .object({
          provider: z.enum(['botpress', 'custom']),
          agentName: z.string().trim().min(1).max(100),
          projectName: z.string().trim().min(1).max(100),
          description: z.string().trim().min(1).max(500),
          capabilities: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
          limitations: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
          expiresInDays: z.number().int().min(1).max(365).default(365),
        })
        .parse(request.body);
      const created = await createHostedProviderAgent(repository, owner, value);
      try {
        const accessToken = await repository.issueAgentAccessToken(owner, created.agent.agentId, {
          name: 'Botpress',
          expiresInDays: value.expiresInDays,
        });
        return { ...created, provider: value.provider, accessToken };
      } catch (error) {
        if (repository.deleteAgent)
          await repository.deleteAgent(owner, created.agent.agentId).catch(() => undefined);
        throw error;
      }
    });
    router.post('/v0.1/quickstart/agent', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const value = z
        .object({
          agentName: z.string().trim().min(1).max(100),
          projectName: z.string().trim().min(1).max(100).default('My agents'),
          description: z.string().trim().min(1).max(500),
          framework: z.string().trim().min(1).max(100).optional(),
          capabilities: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
          limitations: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
        })
        .strict()
        .parse(request.body);
      const created = await createDashboardAgent(repository, owner, value);
      return created;
    });
    router.post('/v0.1/agents', async (request) => {
      const owner = operatorId(request);
      const current = await scopedEngine(request);
      const identity = AgentIdentitySchema.parse(request.body);
      if (owner && identity.operatorRef !== `auth0:${owner}`)
        throw new Error('Agent identity is not owned by the authenticated operator');
      const registered = current.registerAgent(identity);
      await persist(request, 'agent', identity.agentId, registered);
      return registered;
    });
    router.get('/v0.1/agents/:id', async (request) => {
      const { id } = request.params as { id: string };
      const value = (await scopedEngine(request)).agents.get(id);
      if (!value) throw new Error('Agent not found');
      return value;
    });
    router.post('/v0.1/agents/:id/publication', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const { id } = request.params as { id: string };
      const { published } = z.object({ published: z.boolean() }).parse(request.body);
      const rows = await repository.list(owner);
      const agent = rows.find((row) => row.kind === 'agent_profile' && row.recordId === id)
        ?.payload as AgentProfile | undefined;
      if (!agent) throw new Error('Owned agent not found');
      if (agent.status !== 'active') throw new Error('Revoked agents cannot be published');
      if (!published) {
        await repository.unpublishAgent(owner, id);
        const publication = { agentId: id, published: false, updatedAt: new Date().toISOString() };
        await repository.upsert(owner, 'publication', id, publication);
        return publication;
      }
      const previous = await repository.getPublishedAgent(id);
      const card = await repository.publishAgent(
        owner,
        buildPublicAgentCard(agent, publicBaseUrl(request), previous),
      );
      const publication = publicPublication(card);
      await repository.upsert(owner, 'publication', id, publication);
      return { ...publication, card };
    });
    router.put('/v0.1/agents/:id/automation', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const { id } = request.params as { id: string };
      const value = z
        .object({
          autoPublish: z.boolean(),
          autoAcceptPolicy: z.enum(['off', 'safe_matching']),
          autoAcceptTaskCategories: z.array(z.string().trim().min(1).max(100)).max(100),
        })
        .parse(request.body);
      const rows = await repository.list(owner);
      const current = rows.find((row) => row.kind === 'agent_profile' && row.recordId === id)
        ?.payload as AgentProfile | undefined;
      if (!current) throw new Error('Owned agent not found');
      const agent: AgentProfile = {
        ...current,
        transport: 'direct_a2a',
        description: current.description ?? '',
        agentVersion: current.agentVersion ?? '1.0.0',
        autoPublish: value.autoPublish,
        autoAcceptPolicy: value.autoAcceptPolicy,
        autoAcceptTaskCategories: [...new Set(value.autoAcceptTaskCategories)],
        updatedAt: new Date().toISOString(),
      };
      await repository.upsert(owner, 'agent_profile', id, agent);
      if (value.autoPublish) {
        const previous = await repository.getPublishedAgent(id);
        const card = await repository.publishAgent(
          owner,
          buildPublicAgentCard(agent, publicBaseUrl(request), previous),
        );
        await repository.upsert(owner, 'publication', id, publicPublication(card));
      } else {
        await repository.unpublishAgent(owner, id);
        await repository.upsert(owner, 'publication', id, {
          agentId: id,
          published: false,
          updatedAt: new Date().toISOString(),
        });
      }
      return agent;
    });
    router.put('/v0.1/agents/:id/runtime', async (request) => {
      const owner = operatorId(request);
      if (!repository?.registerAgentRuntime || !owner)
        throw new Error('Hosted runtime delivery is not configured');
      const endpoint = z
        .object({ endpoint: z.string().url().max(2048) })
        .parse(request.body).endpoint;
      return repository.registerAgentRuntime(
        owner,
        (request.params as { id: string }).id,
        endpoint,
      );
    });
    router.delete('/v0.1/agents/:id/runtime', async (request) => {
      const owner = operatorId(request);
      if (!repository?.disableAgentRuntime || !owner)
        throw new Error('Hosted runtime delivery is not configured');
      return repository.disableAgentRuntime(owner, (request.params as { id: string }).id);
    });
    router.get('/v0.1/agents/:id/access-tokens', async (request) => {
      const owner = operatorId(request);
      if (!repository?.listAgentAccessTokens || !owner)
        throw new Error('Agent access tokens are not configured');
      return repository.listAgentAccessTokens(owner, (request.params as { id: string }).id);
    });
    router.post('/v0.1/agents/:id/access-tokens', async (request) => {
      const owner = operatorId(request);
      if (!repository?.issueAgentAccessToken || !owner)
        throw new Error('Agent access tokens are not configured');
      const value = z
        .object({
          name: z.string().trim().min(1).max(100),
          expiresInDays: z.number().int().min(1).max(365).default(365),
        })
        .parse(request.body);
      return repository.issueAgentAccessToken(owner, (request.params as { id: string }).id, value);
    });
    router.delete('/v0.1/agents/:id/access-tokens/:tokenId', async (request) => {
      const owner = operatorId(request);
      if (!repository?.revokeAgentAccessToken || !owner)
        throw new Error('Agent access tokens are not configured');
      const params = request.params as { id: string; tokenId: string };
      return repository.revokeAgentAccessToken(owner, params.id, params.tokenId);
    });
    router.delete('/v0.1/agents/:id', async (request) => {
      const owner = operatorId(request);
      if (!repository?.deleteAgent || !owner)
        throw new Error('Hosted agent deletion is not configured');
      const result = await repository.deleteAgent(owner, (request.params as { id: string }).id);
      engines.delete(owner);
      return result;
    });
    router.get('/v0.1/directory', async (request) => {
      operatorId(request);
      if (!repository) throw new Error('Hosted persistence is not configured');
      const query = z
        .object({
          query: z.string().trim().max(100).optional(),
          capability: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .parse(request.query);
      return repository.searchPublishedAgents(query);
    });
    router.get('/v0.1/directory/:id', async (request) => {
      operatorId(request);
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return card;
    });
    router.get('/v0.1/federated-interactions', async (request) => {
      const owner = operatorId(request);
      if (!repository?.listFederatedInteractions || !owner)
        throw new Error('Federated interactions are not configured');
      return repository.listFederatedInteractions(owner);
    });
    router.get('/v0.1/federated-interactions/:id', async (request) => {
      const owner = operatorId(request);
      if (!repository?.getFederatedInteraction || !owner)
        throw new Error('Federated interactions are not configured');
      const interaction = await repository.getFederatedInteraction(
        owner,
        (request.params as { id: string }).id,
      );
      if (!interaction) throw new Error('Interaction not found');
      return interaction;
    });
    router.get('/v0.1/federated-interactions/:id/session', async (request) => {
      const owner = operatorId(request);
      if (!repository?.getLiveSession || !owner)
        throw new Error('Live sessions are not configured');
      const value = z.object({ agentId: z.string().min(1) }).parse(request.query);
      enforceBoundAgent(request, value.agentId);
      return repository.getLiveSession(owner, (request.params as { id: string }).id, value.agentId);
    });
    router.get('/v0.1/federated-interactions/:id/brief', async (request) => {
      const owner = operatorId(request);
      if (!repository?.getCounterpartyBrief || !owner)
        throw new Error('Counterparty briefs are not configured');
      const value = z.object({ agentId: z.string().min(1) }).parse(request.query);
      enforceBoundAgent(request, value.agentId);
      return repository.getCounterpartyBrief(
        owner,
        (request.params as { id: string }).id,
        value.agentId,
      );
    });
    router.post('/v0.1/federated-interactions/:id/completion-reports', async (request) => {
      const owner = operatorId(request);
      if (!repository?.submitCompletionReport || !owner)
        throw new Error('Completion reports are not configured');
      const report = InteractionCompletionReportSchema.parse(request.body);
      if (report.interactionId !== (request.params as { id: string }).id)
        throw new Error('Interaction path does not match the completion report');
      return repository.submitCompletionReport(
        owner,
        boundAgentId(request),
        report,
        request.headers['x-openclasp-credential-type'] === 'agent_access_token'
          ? 'agent_access_token'
          : 'oauth_installation',
      );
    });
    router.post('/v0.1/federated-interactions/:id/feedback', async (request) => {
      const owner = operatorId(request);
      if (!repository?.submitInteractionFeedback || !owner)
        throw new Error('Interaction feedback is not configured');
      const feedback = InteractionFeedbackSchema.parse(request.body);
      if (feedback.interactionId !== (request.params as { id: string }).id)
        throw new Error('Interaction path does not match the feedback');
      return repository.submitInteractionFeedback(
        owner,
        boundAgentId(request),
        feedback,
        request.headers['x-openclasp-credential-type'] === 'agent_access_token'
          ? 'agent_access_token'
          : 'oauth_installation',
      );
    });
    router.get('/v0.1/feedback-requests', async (request) => {
      const owner = operatorId(request);
      if (!repository?.listFeedbackRequests || !owner)
        throw new Error('Interaction feedback is not configured');
      const value = z.object({ agentId: z.string().min(1) }).parse(request.query);
      enforceBoundAgent(request, value.agentId);
      return repository.listFeedbackRequests(owner, value.agentId);
    });
    router.post('/v0.1/federated-interactions', async (request) => {
      const owner = operatorId(request);
      if (!repository?.createFederatedInteraction || !owner)
        throw new Error('Federated interactions are not configured');
      const interaction = FederatedInteractionSchema.parse(request.body);
      const acceptance = interaction.acceptances[interaction.initiatorAgentId];
      if (!acceptance) throw new Error('Initiator acceptance is required');
      return repository.createFederatedInteraction(owner, {
        ...interaction,
        acceptances: {
          [interaction.initiatorAgentId]: { ...acceptance, method: 'oauth_account' },
        },
      });
    });
    router.post('/v0.1/federated-interactions/:id/respond', async (request) => {
      const owner = operatorId(request);
      if (!repository?.respondToFederatedInteraction || !owner)
        throw new Error('Federated interactions are not configured');
      const value = z
        .object({ agentId: z.string().min(1), decision: z.enum(['accept', 'reject']) })
        .parse(request.body);
      return repository.respondToFederatedInteraction(
        owner,
        (request.params as { id: string }).id,
        value.agentId,
        value.decision,
        'oauth_account',
      );
    });
    router.post('/v0.1/federated-interactions/:id/contract-proposals', async (request) => {
      const owner = operatorId(request);
      if (!repository?.proposeContractRevision || !owner)
        throw new Error('Contract negotiation is not configured');
      const value = z
        .object({
          agentId: z.string().min(1),
          expectedTermsHash: z.string().min(1).optional(),
          contract: InteractionContractSchema,
        })
        .parse(request.body);
      enforceBoundAgent(request, value.agentId);
      return repository.proposeContractRevision(
        owner,
        (request.params as { id: string }).id,
        value.agentId,
        value.contract,
        value.expectedTermsHash,
        request.headers['x-openclasp-credential-type'] === 'agent_access_token'
          ? 'oauth_installation'
          : 'oauth_account',
      );
    });
    router.post(
      '/v0.1/federated-interactions/:id/contract-proposals/:revisionId/respond',
      async (request) => {
        const owner = operatorId(request);
        if (!repository?.respondToContractRevision || !owner)
          throw new Error('Contract negotiation is not configured');
        const value = z
          .object({ agentId: z.string().min(1), decision: z.enum(['accept', 'reject']) })
          .parse(request.body);
        enforceBoundAgent(request, value.agentId);
        const params = request.params as { id: string; revisionId: string };
        return repository.respondToContractRevision(
          owner,
          params.id,
          value.agentId,
          params.revisionId,
          value.decision,
          request.headers['x-openclasp-credential-type'] === 'agent_access_token'
            ? 'oauth_installation'
            : 'oauth_account',
        );
      },
    );
    router.post('/v0.1/delegations', async (request) => {
      const value = DelegationCredentialSchema.parse(request.body);
      const current = await scopedEngine(request);
      current.delegations.set(value.delegationId, value);
      await persist(request, 'delegation', value.delegationId, value);
      return { valid: current.verifyDelegation(value.delegationId) };
    });
    router.post('/v0.1/delegations/:id/verify', async (request) => ({
      valid: (await scopedEngine(request)).verifyDelegation((request.params as { id: string }).id),
    }));
    router.post('/v0.1/interactions/contracts', async (request) => {
      const contract = (await scopedEngine(request)).saveContract(
        InteractionContractSchema.parse(request.body),
      );
      await persist(request, 'contract', contract.interactionId, contract);
      return contract;
    });
    router.post('/v0.1/events', async (request) => {
      const event = (await scopedEngine(request)).recordEvent(
        InteractionEventSchema.parse(request.body),
      );
      await persist(request, 'event', event.eventId, event);
      return event;
    });
    router.post('/v0.1/risk/assess', async (request) =>
      (await scopedEngine(request)).assess(request.body as any),
    );
    router.get('/v0.1/profiles/:id', async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { version?: string; taskCategory?: string };
      return (await scopedEngine(request)).getRisk(
        id,
        query.version ?? '1.0.0',
        query.taskCategory ?? 'general',
      );
    });
    router.post('/v0.1/claims/check', async (request) =>
      ((value) => factChecker.check(value.claim, value.permission))(
        z.object({ claim: z.string(), permission: z.boolean().optional() }).parse(request.body),
      ),
    );
    router.post('/v0.1/receipts', async (request) => {
      const receipt = (await scopedEngine(request)).submitReceipt(
        ReceiptSchema.parse(request.body),
      );
      await persist(request, 'receipt', receipt.receiptId, receipt);
      return receipt;
    });
    router.post('/v0.1/receipts/verify', async (request) => {
      try {
        (await scopedEngine(request)).verifyReceipt(ReceiptSchema.parse(request.body));
        return { valid: true };
      } catch {
        return { valid: false };
      }
    });
    router.post('/v0.1/feedback', async (request) => {
      const feedback = FeedbackSchema.parse(request.body);
      const current = await scopedEngine(request);
      const result = current.submitFeedback(feedback);
      await persist(request, 'feedback', feedback.feedbackId, feedback);
      for (const profile of current.profiles.values())
        await persist(
          request,
          'profile',
          `${profile.agentId}|${profile.agentVersion}|${profile.taskCategory}`,
          profile,
        );
      return result;
    });
    router.post('/v0.1/conflicts', async (request) => {
      const conflict = (await scopedEngine(request)).createConflict(request.body as any);
      await persist(request, 'conflict', conflict.conflictId, conflict);
      return conflict;
    });
    router.post('/v0.1/conflicts/:id/permit', async (request) => {
      const conflict = (await scopedEngine(request)).permitMediation(
        (request.params as { id: string }).id,
        (request.body as { agentId: string }).agentId,
      );
      await persist(request, 'conflict', conflict.conflictId, conflict);
      return conflict;
    });
    router.post('/v0.1/conflicts/:id/resolve', async (request) => {
      const conflict = (await scopedEngine(request)).resolveConflict(
        (request.params as { id: string }).id,
        (request.body as { resolution: string }).resolution,
      );
      await persist(request, 'conflict', conflict.conflictId, conflict);
      return conflict;
    });
    router.post('/v0.1/revocations/agents/:id', async (request) => {
      const id = (request.params as { id: string }).id;
      const current = await scopedEngine(request);
      current.revokeAgent(id);
      await persist(request, 'agent', id, current.agents.get(id));
      return { revoked: true };
    });
    router.post('/v0.1/revocations/delegations/:id', async (request) => {
      const id = (request.params as { id: string }).id;
      const current = await scopedEngine(request);
      current.revokeDelegation(id);
      await persist(request, 'delegation', id, current.delegations.get(id));
      return { revoked: true };
    });
    router.post('/v0.1/contributions/consent', async (request) => {
      const value = z.object({ agentId: z.string(), enabled: z.boolean() }).parse(request.body);
      const current = await scopedEngine(request);
      current.setContributionConsent(value.agentId, value.enabled);
      await persist(request, 'consent', value.agentId, {
        agentId: value.agentId,
        ...current.contributionConsent.get(value.agentId),
      });
      return value;
    });
  });
  return app;
}
