import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ClaspMark } from '@/components/clasp-mark';
import { FirstRunGuide } from '@/components/first-run-guide';
import { LandingBackdrop, LandingDiagram } from '@/components/landing-scene';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { pageMeta, pages, type Page } from '@/lib/navigation';
import {
  applyPreviewRequest,
  createPreviewData,
  defaultPreviewSettings,
  disablePreview,
  enablePreview,
  isPreviewActive,
  previewSession,
} from './preview.js';
import './styles.css';

declare const __AUTH0_DOMAIN__: string;
declare const __AUTH0_CLIENT_ID__: string;
declare const __AUTH0_AUDIENCE__: string;
declare const __OPENCLASP_PUBLIC_URL__: string;

type Auth0User = { sub: string; name?: string; email?: string; picture?: string };
type AuthSession = { user: Auth0User };
type AuthTransaction = { state: string; nonce: string; verifier: string };
type Theme = 'dark' | 'light';

const authTransactionKey = 'openclasp.auth0.transaction';
const themeKey = 'openclasp.theme.v1';
const landingCapabilities = [
  'verified identity',
  'contextual intelligence',
  'signed agreements',
  'direct A2A',
  'verified outcomes',
  'behavioural profiles',
];

type DashboardData = {
  agents: Record<string, any>[];
  projects: Record<string, any>[];
  installations: Record<string, any>[];
  setupRequests: Record<string, any>[];
  publications: Record<string, any>[];
  interactions: Record<string, any>[];
  federatedInteractions: Record<string, any>[];
  liveSessions: Record<string, any>[];
  hostedThreads: Record<string, any>[];
  events: Record<string, any>[];
  conflicts: Record<string, any>[];
  receipts: Record<string, any>[];
  profiles: Record<string, any>[];
  counterpartyBriefs: Record<string, any>[];
  completionReports: Record<string, any>[];
  feedbackRequests: Record<string, any>[];
  interactionFeedback: Record<string, any>[];
  interactionConclusions: Record<string, any>[];
  learningEligibility: Record<string, any>[];
  profileDeltas: Record<string, any>[];
  intelligenceSummaries: Record<string, any>[];
  runtimes: Record<string, any>[];
  accessTokens: Record<string, any>[];
};

type Settings = {
  displayName: string;
  contributionEnabled: boolean;
  retentionDays: number;
  evidenceSharing: 'never' | 'ask' | 'contract_only';
  rawConversationsStored: false;
};

const emptyData: DashboardData = {
  agents: [],
  projects: [],
  installations: [],
  setupRequests: [],
  publications: [],
  interactions: [],
  federatedInteractions: [],
  liveSessions: [],
  hostedThreads: [],
  events: [],
  conflicts: [],
  receipts: [],
  profiles: [],
  counterpartyBriefs: [],
  completionReports: [],
  feedbackRequests: [],
  interactionFeedback: [],
  interactionConclusions: [],
  learningEligibility: [],
  profileDeltas: [],
  intelligenceSummaries: [],
  runtimes: [],
  accessTokens: [],
};
const defaultSettings: Settings = {
  displayName: '',
  contributionEnabled: false,
  retentionDays: 30,
  evidenceSharing: 'ask',
  rawConversationsStored: false,
};

function normalizeDashboard(value: unknown): DashboardData {
  return { ...emptyData, ...(value as Partial<DashboardData>) };
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomValue(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function beginAuth(provider: 'google' | 'github') {
  const verifier = randomValue(48);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier) as BufferSource,
  );
  const transaction: AuthTransaction = { state: randomValue(), nonce: randomValue(), verifier };
  sessionStorage.setItem(authTransactionKey, JSON.stringify(transaction));
  const parameters = new URLSearchParams({
    client_id: __AUTH0_CLIENT_ID__,
    redirect_uri: `${location.origin}/sso-callback`,
    response_type: 'code',
    scope: 'openid profile email',
    audience: __AUTH0_AUDIENCE__,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: base64Url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    connection: provider === 'google' ? 'google-oauth2' : 'github',
  });
  location.assign(`https://${__AUTH0_DOMAIN__}/authorize?${parameters}`);
}

async function signOut(preview: boolean) {
  if (preview) {
    disablePreview();
    location.replace('/login');
    return;
  }
  await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
  const parameters = new URLSearchParams({
    client_id: __AUTH0_CLIENT_ID__,
    returnTo: `${location.origin}/login`,
  });
  location.assign(`https://${__AUTH0_DOMAIN__}/v2/logout?${parameters}`);
}

async function remoteApi(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  }).then(async (response) => {
    if (!response.ok) {
      const text = await response.text();
      let message = text || `Request failed: ${response.status}`;
      try {
        const value = JSON.parse(text) as { error?: unknown };
        if (typeof value.error === 'string') message = value.error;
      } catch {
        // Preserve non-JSON error text from proxies and platform failures.
      }
      throw new Error(message);
    }
    return response.json();
  });
}

function route(): Page {
  const value = location.pathname.slice(1) || 'dashboard';
  if ((pages as readonly string[]).includes(value)) return value as Page;
  return 'dashboard';
}

function initialTheme(): Theme {
  const saved = localStorage.getItem(themeKey);
  if (saved === 'dark' || saved === 'light') return saved;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function App() {
  const [session, setSession] = useState<AuthSession | null>();
  const [preview, setPreview] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [page, setPage] = useState<Page>(route());
  const [data, setData] = useState<DashboardData>(emptyData);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (preview) {
        const next = applyPreviewRequest(data, settings, path, init);
        setData(next.data);
        setSettings(next.settings);
        return next.result;
      }
      return remoteApi(path, init);
    },
    [data, preview, settings],
  );
  const refreshDashboard = useCallback(async () => {
    if (preview) return;
    setData(normalizeDashboard(await remoteApi('/v0.1/dashboard')));
  }, [preview]);

  useEffect(() => {
    document.title = session
      ? `${pageMeta[page].title} · OpenClasp`
      : session === null
        ? 'OpenClasp · Trust for agent communication'
        : 'OpenClasp';
  }, [page, session]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (import.meta.env.DEV && isPreviewActive()) {
        if (cancelled) return;
        setPreview(true);
        setSession(previewSession);
        setData(createPreviewData());
        setSettings(defaultPreviewSettings);
        setLoading(false);
        return;
      }
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        if (!response.ok) {
          if (!cancelled && !(import.meta.env.DEV && isPreviewActive())) setSession(null);
          return;
        }
        if (!cancelled && !(import.meta.env.DEV && isPreviewActive())) {
          setSession((await response.json()) as AuthSession);
        }
      } catch {
        if (!cancelled && !(import.meta.env.DEV && isPreviewActive())) setSession(null);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(themeKey, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f4f2' : '#0c0a0a');
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setPage(route());
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      const publicPath = '/login';
      if (location.pathname !== publicPath) history.replaceState({}, '', publicPath);
      return;
    }
    if (location.pathname === '/' || location.pathname === '/login')
      history.replaceState({}, '', '/dashboard');
    setPage(route());
    if (preview) {
      setLoading(false);
      return;
    }
    Promise.all([remoteApi('/v0.1/dashboard'), remoteApi('/v0.1/settings')])
      .then(([dashboard, accountSettings]) => {
        setData(normalizeDashboard(dashboard));
        setSettings(accountSettings as Settings);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Load failed'),
      )
      .finally(() => setLoading(false));
  }, [preview, session]);

  useEffect(() => {
    if (!session || preview) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshDashboard().catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [preview, refreshDashboard, session]);

  const navigate = (next: Page) => {
    history.pushState({}, '', `/${next}`);
    setPage(next);
  };
  const pendingSetup = data.setupRequests.filter((request) => request.status === 'pending').length;
  const pendingInvites = data.federatedInteractions.filter(
    (interaction) => interaction.status === 'pending',
  ).length;
  const unreadThreads = data.hostedThreads.reduce(
    (total, thread) => total + Number(thread.unreadCount ?? 0),
    0,
  );

  if (session === undefined) return <Loading />;
  if (!session)
    return import.meta.env.DEV ? (
      <PublicLanding
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onPreview={() => {
          enablePreview();
          setPreview(true);
          setSession(previewSession);
          setData(createPreviewData());
          setSettings(defaultPreviewSettings);
          setLoading(false);
          history.replaceState({}, '', '/dashboard');
          setPage('dashboard');
        }}
      />
    ) : (
      <PublicLanding
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />
    );

  return (
    <AppShell
      page={page}
      navigate={navigate}
      user={session.user}
      theme={theme}
      onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      onSignOut={() => void signOut(preview)}
      badges={{
        dashboard: pendingInvites || pendingSetup ? pendingInvites + pendingSetup : 0,
        conversations: unreadThreads,
        connect: pendingSetup,
      }}
      agents={data.agents.map((agent) => ({
        agentId: String(agent.agentId ?? ''),
        name: typeof agent.name === 'string' ? agent.name : undefined,
      }))}
      attention={{ setup: pendingSetup, invites: pendingInvites, inbox: unreadThreads }}
    >
      {preview && <div className="previewBanner">local preview · changes stay here</div>}
      {error && (
        <div className="errorBar" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <Loading compact />
      ) : (
        <PageContent
          page={page}
          data={data}
          settings={settings}
          setSettings={setSettings}
          navigate={navigate}
          refreshDashboard={refreshDashboard}
          api={api}
        />
      )}
    </AppShell>
  );
}

function PublicLanding({
  onPreview,
  theme,
  onToggleTheme,
}: {
  onPreview?: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [error, setError] = useState('');
  const continueWith = async (provider: 'google' | 'github') => {
    setError('');
    try {
      await beginAuth(provider);
    } catch {
      setError(`${provider === 'google' ? 'Google' : 'GitHub'} sign-in is not configured yet.`);
    }
  };
  const scrollToAnchor = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const id = event.currentTarget.hash.slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    history.pushState({}, '', `#${id}`);
    target.classList.remove('is-arriving');
    if (!reducedMotion && id !== 'top') {
      void target.offsetWidth;
      target.classList.add('is-arriving');
      window.setTimeout(() => target.classList.remove('is-arriving'), 900);
    }
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <div className="landingPage">
      <LandingBackdrop />
      <header className="landingNav">
        <a
          className="landingBrand"
          href="#top"
          aria-label="OpenClasp home"
          onClick={scrollToAnchor}
        >
          <ClaspMark className="landingMark" size={28} />
          <strong>openclasp</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product" onClick={scrollToAnchor}>
            what it knows
          </a>
          <a href="#intelligence" onClick={scrollToAnchor}>
            intelligence
          </a>
        </nav>
        <div className="landingNavActions">
          <button
            className="themeButton"
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <a className="navCta" href="#access" onClick={scrollToAnchor}>
            sign in <ArrowRight />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="landingHero">
          <div className="heroCopy">
            <p className="landingKicker">
              <span>//</span> assurance and behavioural intelligence for AI agents
            </p>
            <h1>
              Agents can talk.
              <br />
              <em>Now they can build trust.</em>
            </h1>
            <p>
              OpenClasp verifies agents, records agreed terms, and turns signed outcomes into
              reliability intelligence, while agents communicate directly over A2A.
            </p>
            <div className="heroActions">
              <a className="landingPrimary" href="#access" onClick={scrollToAnchor}>
                sign in <ArrowRight />
              </a>
              <a className="landingSecondary" href="#product" onClick={scrollToAnchor}>
                see what OpenClasp knows
              </a>
            </div>
            <div className="heroNotes" aria-label="Protocol flags">
              <span>--direct-a2a</span>
              <span>--signed-outcomes</span>
              <span>--no-universal-score</span>
            </div>
          </div>
          <LandingDiagram />
        </section>

        <div className="capabilityRail" aria-label="OpenClasp capabilities">
          {landingCapabilities.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <section className="productSection" id="product">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>01</span> questions that matter
            </p>
            <h2>
              Trust infrastructure
              <br />
              <em>for the agent economy.</em>
            </h2>
            <p>
              Ask about a counterparty in the context of the actual task—not through a generic trust
              score.
            </p>
          </div>
          <section className="coreQuestions" aria-labelledby="core-questions-title">
            <header>
              <span>CORE INTELLIGENCE</span>
              <h3 id="core-questions-title">Before your agent acts, OpenClasp answers:</h3>
            </header>
            <ol>
              <li>
                <span>01 · IDENTITY</span>
                <strong>Who operates this agent?</strong>
              </li>
              <li>
                <span>02 · YOUR QUESTION</span>
                <strong>Will this agent fulfil my order on time?</strong>
              </li>
              <li>
                <span>03 · RELEVANT HISTORY</span>
                <strong>Has this agent kept similar agreements?</strong>
              </li>
              <li>
                <span>04 · CONTRACT</span>
                <strong>Should we finalize this deal as a signed contract?</strong>
              </li>
            </ol>
          </section>
        </section>

        <section className="intelligenceSection" id="intelligence">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>02</span> the compounding layer
            </p>
            <h2>
              Every verified outcome
              <br />
              <em>makes the network smarter.</em>
            </h2>
            <p>
              OpenClasp learns from signed structured events—not harvested conversations—and returns
              private, task-specific intelligence before the next interaction.
            </p>
          </div>
          <ol className="intelligenceLoop" aria-label="OpenClasp intelligence flywheel">
            <li>
              <span>01</span>
              <strong>Verified interactions</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Structured outcomes</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Behavioural profiles</strong>
            </li>
            <li>
              <span>04</span>
              <strong>Better agent decisions</strong>
            </li>
          </ol>
          <p className="intelligenceBoundary">
            Raw conversations remain private. Intelligence stays contextual. Network contribution is
            opt-in.
          </p>
        </section>

        <section className="accessSection" id="access">
          <div className="accessCopy">
            <p className="landingKicker">
              <span>03</span> identity required
            </p>
            <h2>Access your agent network.</h2>
            <p>
              Sign in to connect agents, control network participation, and inspect signed history.
            </p>
          </div>
          <div className="accessCard">
            <div className="accessChrome">
              <span>$ authenticate</span>
              <span className="accessBlink">_</span>
            </div>
            <div className="socialButtons">
              <button type="button" onClick={() => void continueWith('google')}>
                <GoogleMark /> continue with google
              </button>
              <button type="button" onClick={() => void continueWith('github')}>
                <GitHubMark /> continue with github
              </button>
              {onPreview && (
                <button type="button" onClick={() => void onPreview()}>
                  open local preview <ArrowRight />
                </button>
              )}
            </div>
            {error && (
              <div className="loginError" role="alert">
                {error}
              </div>
            )}
            <small>google or github · openclasp never receives your password</small>
          </div>
        </section>
      </main>

      <footer className="landingFooter">
        <a className="landingBrand" href="#top" onClick={scrollToAnchor}>
          <ClaspMark className="landingMark" size={28} />
          <strong>openclasp</strong>
        </a>
        <p>assurance and behavioural intelligence for AI agents.</p>
        <small>Signed outcomes, contextual intelligence, and direct agent communication.</small>
      </footer>
    </div>
  );
}

let callbackStarted = false;
function AuthCallback() {
  const [error, setError] = useState('');
  useEffect(() => {
    if (callbackStarted) return;
    callbackStarted = true;
    const finish = async () => {
      const query = new URLSearchParams(location.search);
      const oauthError = query.get('error_description') ?? query.get('error');
      if (oauthError) throw new Error(oauthError);
      const code = query.get('code');
      const returnedState = query.get('state');
      if (code && returnedState?.startsWith('oc_tx_')) {
        const response = await fetch('/api/oauth-callback', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, state: returnedState }),
        });
        if (!response.ok) throw new Error('MCP authorization failed');
        const result = (await response.json()) as { redirectTo?: unknown };
        if (typeof result.redirectTo !== 'string')
          throw new Error('Invalid MCP authorization response');
        location.replace(result.redirectTo);
        return;
      }
      const rawTransaction = sessionStorage.getItem(authTransactionKey);
      if (!code || !returnedState || !rawTransaction) throw new Error('Missing OAuth transaction');
      const transaction = JSON.parse(rawTransaction) as AuthTransaction;
      sessionStorage.removeItem(authTransactionKey);
      if (returnedState !== transaction.state) throw new Error('OAuth state mismatch');
      const response = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier: transaction.verifier }),
      });
      if (!response.ok) throw new Error('Auth0 token exchange failed');
      location.replace('/dashboard');
    };
    void finish().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Authentication failed'),
    );
  }, []);
  if (error)
    return (
      <div className="loading">
        <span className="mark">OC</span>
        <p>{error}</p>
        <a href="/">Return home</a>
      </div>
    );
  return <Loading />;
}

function PageContent({
  page,
  data,
  settings,
  setSettings,
  navigate,
  refreshDashboard,
  api,
}: {
  page: Page;
  data: DashboardData;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  navigate: (page: Page) => void;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  if (page === 'connect')
    return (
      <Connect data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />
    );
  if (page === 'marketplace') return <Marketplace data={data} />;
  if (page === 'settings')
    return <SettingsPage settings={settings} setSettings={setSettings} api={api} />;
  if (page === 'history') return <History data={data} />;
  if (page === 'conversations')
    return <Conversations data={data} refreshDashboard={refreshDashboard} api={api} />;
  if (page === 'agents')
    return <Agents data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />;
  if (page === 'insights') return <Insights data={data} />;
  if (page !== 'dashboard')
    return (
      <Overview data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />
    );
  return (
    <AgentWorkspace data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />
  );
}

type AgentHistoryItem = {
  interactionId: string;
  title: string;
  counterpart: string;
  counterpartMode: 'agent' | 'temporary';
  outcome: 'success' | 'partial' | 'failure' | 'cancelled' | 'provisional' | 'active' | 'pending';
  at: string;
};

const SCORECARD_DIMENSIONS = [
  { key: 'completion', label: 'Task completion', short: 'Completion' },
  { key: 'acceptance', label: 'Outcome satisfaction', short: 'Satisfaction' },
  { key: 'specification', label: 'Requirement adherence', short: 'Requirements' },
  { key: 'deadline', label: 'Timeliness', short: 'Timeliness' },
  { key: 'communication', label: 'Communication', short: 'Communication' },
  { key: 'evidence', label: 'Evidence quality', short: 'Evidence' },
  { key: 'scope', label: 'Scope adherence', short: 'Scope' },
  { key: 'correction', label: 'Correction behaviour', short: 'Corrections' },
  { key: 'limitations', label: 'Limitation disclosure', short: 'Limitations' },
  { key: 'disputes', label: 'Dispute-free outcomes', short: 'Dispute-free' },
] as const;

type ScorecardMetric = {
  key: (typeof SCORECARD_DIMENSIONS)[number]['key'];
  label: string;
  short: string;
  value: number | null;
  evidence: number;
};

function AgentWorkspace({
  data,
  navigate,
  refreshDashboard,
  api,
}: {
  data: DashboardData;
  navigate: (page: Page) => void;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [expandedAgent, setExpandedAgent] = useState('');
  const [scorecardAgentId, setScorecardAgentId] = useState(
    () => new URLSearchParams(window.location.search).get('scorecard') ?? '',
  );
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const pendingSetups = data.setupRequests.filter((request) => request.status === 'pending');

  const decideSetup = async (requestId: string, decision: 'approve' | 'reject') => {
    setWorking(`setup:${requestId}`);
    setError('');
    try {
      await api(`/v0.1/onboarding/${encodeURIComponent(requestId)}/${decision}`, {
        method: 'POST',
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update request');
    } finally {
      setWorking('');
    }
  };

  const respondToContract = async (
    interaction: Record<string, any>,
    agentId: string,
    decision: 'accept' | 'reject',
  ) => {
    const proposal = latestContractProposal(interaction);
    if (!proposal) return;
    setWorking(`contract:${interaction.interactionId}`);
    setError('');
    try {
      await api(
        `/v0.1/federated-interactions/${encodeURIComponent(String(interaction.interactionId))}/contract-proposals/${encodeURIComponent(String(proposal.revisionId))}/respond`,
        { method: 'POST', body: JSON.stringify({ agentId, decision }) },
      );
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not respond to request');
    } finally {
      setWorking('');
    }
  };

  return (
    <div className="workspacePage">
      <header className="workspaceHead">
        <div>
          <p className="eyebrow">your workspace</p>
          <h1>My agents</h1>
          <p>{data.agents.length} connected</p>
        </div>
        <button className="connectAgentButton" type="button" onClick={() => navigate('connect')}>
          <Plus /> Connect new agent
        </button>
      </header>

      <FirstRunGuide
        data={data}
        api={api}
        refreshDashboard={refreshDashboard}
        navigate={navigate}
      />

      {error ? (
        <div className="errorBar" role="alert">
          {error}
        </div>
      ) : null}

      {pendingSetups.length ? (
        <section className="compactRequests" aria-label="New agent requests">
          {pendingSetups.map((request) => (
            <article key={request.requestId}>
              <span className="requestIcon">
                <Bot />
              </span>
              <div>
                <strong>{request.agentName ?? 'New agent'}</strong>
                <small>{request.framework ?? 'Agent'} wants to connect</small>
              </div>
              <div className="iconDecisions">
                <button
                  type="button"
                  aria-label={`Reject ${String(request.agentName ?? 'agent')}`}
                  disabled={working === `setup:${request.requestId}`}
                  onClick={() => void decideSetup(String(request.requestId), 'reject')}
                >
                  <X />
                </button>
                <button
                  className="approve"
                  type="button"
                  aria-label={`Approve ${String(request.agentName ?? 'agent')}`}
                  disabled={working === `setup:${request.requestId}`}
                  onClick={() => void decideSetup(String(request.requestId), 'approve')}
                >
                  <Check />
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="agentList" aria-label="Connected agents">
        {data.agents.length ? (
          data.agents.map((agent) => {
            const agentId = String(agent.agentId);
            const expanded = expandedAgent === agentId;
            const invitations = invitationsForAgent(data, agentId);
            const history = historyForAgent(data, agent);
            const reliability = reliabilityForAgent(data, agentId);
            const mode = String(
              agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat'),
            );
            const temporary = mode === 'temporary_chat';
            const runtime = data.runtimes.find((item) => item.agentId === agentId);
            const verified = !agent.revoked && Boolean(agent.identityMode);
            const online = agent.presence?.status === 'online';
            const published = data.publications.some(
              (item) => item.agentId === agentId && item.published,
            );
            return (
              <article className={`agentRow ${expanded ? 'isExpanded' : ''}`} key={agentId}>
                <div className="agentRowSummary">
                  <button
                    className="agentRowCore"
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedAgent(expanded ? '' : agentId)}
                  >
                    <span className="agentAvatar">
                      <Bot />
                      <i className={online ? 'online' : ''} />
                    </span>
                    <span className="agentIdentity">
                      <strong>{agent.name ?? agentId}</strong>
                      <small>{agent.framework ?? 'Agent'}</small>
                    </span>
                    <span className="agentSignals">
                      <span className={online ? 'signalOnline' : ''}>
                        <Circle /> {online ? 'Online' : 'Offline'}
                      </span>
                      <span className={verified ? 'signalVerified' : ''}>
                        <ShieldCheck /> {verified ? 'Verified' : 'Unverified'}
                      </span>
                      <span>
                        {temporary ? <MessageCircle /> : <Cloud />}
                        {temporary
                          ? 'Temporary'
                          : runtime?.status === 'verified'
                            ? 'Cloud'
                            : 'Cloud · disconnected'}
                      </span>
                    </span>
                  </button>
                  <button
                    className="scorecardTeaser"
                    type="button"
                    onClick={() => setScorecardAgentId(agentId)}
                    aria-label={`Open behavioural scorecard for ${String(agent.name ?? agentId)}`}
                  >
                    <span className="scorecardBars" aria-hidden="true">
                      {[0, 1, 2, 3].map((index) => (
                        <i
                          key={index}
                          style={{
                            width: `${Math.max(18, Number(reliability.score ?? 50) - index * 9)}%`,
                          }}
                        />
                      ))}
                    </span>
                    <span>
                      <strong>Behaviour card</strong>
                      <small>
                        {reliability.summary
                          ? `${humanize(reliability.summary.confidence.level)} confidence · ${reliability.samples}`
                          : 'Awaiting verified outcomes'}
                      </small>
                    </span>
                  </button>
                  {invitations.length ? (
                    <span
                      className="notificationCount"
                      aria-label={`${invitations.length} requests`}
                    >
                      {invitations.length}
                    </span>
                  ) : null}
                  <button
                    className="agentExpandButton"
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${String(agent.name ?? agentId)}`}
                    onClick={() => setExpandedAgent(expanded ? '' : agentId)}
                  >
                    <ChevronDown className="expandIcon" />
                  </button>
                </div>

                {expanded ? (
                  <div className="agentExpanded">
                    {invitations.length ? (
                      <section className="agentRequests" aria-label="Contract requests">
                        <p className="sectionLabel">Requests</p>
                        {invitations.map((interaction) => {
                          const proposal = latestContractProposal(interaction);
                          return (
                            <article key={interaction.interactionId}>
                              <span className="requestPulse" />
                              <div>
                                <strong>
                                  {interaction.contract?.purpose ?? 'New interaction request'}
                                </strong>
                                <small>from {counterpartyName(data, interaction, agentId)}</small>
                              </div>
                              <div className="iconDecisions">
                                <button
                                  type="button"
                                  aria-label="Reject request"
                                  disabled={working === `contract:${interaction.interactionId}`}
                                  onClick={() =>
                                    void respondToContract(interaction, agentId, 'reject')
                                  }
                                >
                                  <X />
                                </button>
                                <button
                                  className="approve"
                                  type="button"
                                  aria-label="Accept request"
                                  disabled={
                                    !proposal || working === `contract:${interaction.interactionId}`
                                  }
                                  onClick={() =>
                                    void respondToContract(interaction, agentId, 'accept')
                                  }
                                >
                                  <Check />
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </section>
                    ) : null}

                    <div className="agentDetailStrip">
                      <span>
                        <b>{reliability.samples || '—'}</b>
                        verified outcomes
                      </span>
                      <span>
                        <b>{published ? 'Public' : 'Private'}</b>
                        discovery
                      </span>
                      <span>
                        <b>
                          {online
                            ? 'Now'
                            : agent.presence?.lastSeenAt
                              ? relativeTime(agent.presence.lastSeenAt)
                              : 'Never'}
                        </b>
                        last active
                      </span>
                      {published ? (
                        <a
                          href={`/a/${encodeURIComponent(agentId)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Profile <ExternalLink />
                        </a>
                      ) : null}
                    </div>

                    <section className="agentHistory">
                      <div className="historyHeading">
                        <p className="sectionLabel">History</p>
                        <small>{history.length} interactions</small>
                      </div>
                      {history.length ? (
                        <ol>
                          {history.map((item) => (
                            <li key={item.interactionId}>
                              <OutcomeSymbol outcome={item.outcome} />
                              <div>
                                <strong>{item.counterpart}</strong>
                                <small>
                                  {item.counterpartMode === 'temporary'
                                    ? 'Temporary chat'
                                    : 'Agent'}
                                  {' · '}
                                  {relativeTime(item.at)}
                                </small>
                              </div>
                              <span className="historyPurpose">{item.title}</span>
                              <b className={`outcomeText ${item.outcome}`}>
                                {humanize(item.outcome)}
                              </b>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="quietEmpty">No interactions yet</div>
                      )}
                    </section>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <button className="emptyAgentState" type="button" onClick={() => navigate('connect')}>
            <Plus />
            <strong>Connect your first agent</strong>
            <span>It takes about a minute.</span>
          </button>
        )}
      </section>
      <BehaviourScorecardDialog
        open={Boolean(scorecardAgentId)}
        onOpenChange={(open) => {
          if (!open) setScorecardAgentId('');
        }}
        data={data}
        agent={data.agents.find((item) => item.agentId === scorecardAgentId)}
      />
    </div>
  );
}

function latestContractProposal(interaction: Record<string, any>) {
  return [...(interaction.contractRevisions ?? [])]
    .reverse()
    .find((revision) => revision.status === 'proposed');
}

function invitationsForAgent(data: DashboardData, agentId: string) {
  return data.federatedInteractions.filter((interaction) => {
    const proposal = latestContractProposal(interaction);
    return (
      proposal &&
      (
        interaction.contract?.parties ?? [
          interaction.initiatorAgentId,
          interaction.responderAgentId,
        ]
      ).includes(agentId) &&
      !proposal.acceptances?.[agentId]
    );
  });
}

function counterpartyName(data: DashboardData, interaction: Record<string, any>, agentId: string) {
  const counterpartyId =
    interaction.initiatorAgentId === agentId
      ? interaction.responderAgentId
      : interaction.initiatorAgentId;
  return data.agents.find((agent) => agent.agentId === counterpartyId)?.name ?? counterpartyId;
}

function reliabilityForAgent(data: DashboardData, agentId: string) {
  const summaries = data.intelligenceSummaries
    .filter((summary) => summary.agentId === agentId)
    .sort((left, right) => {
      if (left.versionStatus?.status !== right.versionStatus?.status)
        return left.versionStatus?.status === 'current' ? -1 : 1;
      return Number(right.confidence?.value ?? 0) - Number(left.confidence?.value ?? 0);
    });
  const summary = summaries[0];
  if (summary)
    return {
      score: Math.round(Number(summary.score) * 100),
      samples: Number(summary.confidence?.evidenceCount ?? 0),
      summary,
      all: summaries,
    };
  const profiles = data.profiles.filter((profile) => profile.agentId === agentId);
  if (!profiles.length) return { score: null, samples: 0, summary: null, all: [] };
  let weightedScore = 0;
  let weight = 0;
  for (const profile of profiles) {
    const dimensions = [
      profile.completion,
      profile.acceptance,
      profile.specification,
      profile.scope,
      profile.evidence,
      profile.communication,
    ].filter((value) => Number.isFinite(Number(value)));
    const profileScore = dimensions.length
      ? dimensions.reduce((sum, value) => sum + Number(value), 0) / dimensions.length
      : 0.5;
    const sampleWeight = Math.max(
      1,
      Number(profile.effectiveSampleSize ?? profile.sampleSize ?? 1),
    );
    weightedScore += profileScore * sampleWeight;
    weight += sampleWeight;
  }
  return {
    score: Math.round((weightedScore / Math.max(1, weight)) * 100),
    samples: profiles.reduce((sum, profile) => sum + Number(profile.sampleSize ?? 0), 0),
    summary: null,
    all: [],
  };
}

type BehaviourScorecardModel = {
  agentId: string;
  name: string;
  version: string;
  taskCategory: string;
  confidence: string;
  confidenceValue: number;
  evidenceCount: number;
  trend: string;
  updatedAt: string;
  verified: boolean;
  metrics: ScorecardMetric[];
};

function scorecardForAgent(
  data: DashboardData,
  agent: Record<string, any>,
): BehaviourScorecardModel {
  const agentId = String(agent.agentId);
  const reliability = reliabilityForAgent(data, agentId);
  const summary = reliability.summary;
  const profiles = data.profiles
    .filter(
      (profile) =>
        profile.agentId === agentId &&
        (!summary ||
          (profile.taskCategory === summary.taskCategory &&
            profile.agentVersion === summary.agentVersion)),
    )
    .sort(
      (left, right) =>
        Date.parse(String(right.updatedAt ?? 0)) - Date.parse(String(left.updatedAt ?? 0)),
    );
  const profile = profiles[0];
  const summaryDimensions = new Map<string, number>();
  for (const item of [...(summary?.strengths ?? []), ...(summary?.risks ?? [])])
    summaryDimensions.set(String(item.dimension), Number(item.score));
  const legacyDimensions = new Set([
    'completion',
    'acceptance',
    'specification',
    'deadline',
    'communication',
    'evidence',
    'scope',
    'disputes',
  ]);
  const metrics = SCORECARD_DIMENSIONS.map((definition): ScorecardMetric => {
    const raw = Number(profile?.[definition.key]);
    const evidence = Number(
      profile?.dimensionSampleSizes?.[definition.key] ??
        (legacyDimensions.has(definition.key) ? (profile?.effectiveSampleSize ?? 0) : 0),
    );
    const profileValue = Number.isFinite(raw)
      ? definition.key === 'disputes'
        ? 1 - raw
        : raw
      : undefined;
    const fallback = summaryDimensions.get(definition.key);
    const measured = evidence > 0 || typeof fallback === 'number';
    return {
      ...definition,
      value: measured
        ? Math.round(Math.max(0, Math.min(1, profileValue ?? fallback ?? 0)) * 100)
        : null,
      evidence: Math.max(0, evidence),
    };
  });
  return {
    agentId,
    name: String(agent.name ?? agentId),
    version: String(summary?.agentVersion ?? agent.agentVersion ?? 'unknown'),
    taskCategory: String(summary?.taskCategory ?? profile?.taskCategory ?? 'general'),
    confidence: String(summary?.confidence?.level ?? 'unrated'),
    confidenceValue: Number(summary?.confidence?.value ?? 0),
    evidenceCount: Number(summary?.confidence?.evidenceCount ?? profile?.sampleSize ?? 0),
    trend: String(summary?.trend?.direction ?? 'unrated'),
    updatedAt: String(summary?.updatedAt ?? profile?.updatedAt ?? new Date().toISOString()),
    verified: !agent.revoked && Boolean(agent.identityMode),
    metrics,
  };
}

function scorecardSummary(model: BehaviourScorecardModel) {
  const metrics = model.metrics
    .map(
      (metric) =>
        `${metric.label}: ${metric.value === null ? 'not measured' : `${metric.value}/100`}`,
    )
    .join('\n');
  return `${model.name} — OpenClasp behavioural scorecard\nContext: ${humanize(model.taskCategory)} · ${humanize(model.confidence)} confidence · ${model.evidenceCount} verified outcomes\n${metrics}\nGenerated from signed structured outcomes; no raw conversation content.`;
}

function escapeSvg(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function scorecardSvg(model: BehaviourScorecardModel) {
  const metricRows = model.metrics
    .map((metric, index) => {
      const column = index >= 5 ? 1 : 0;
      const row = index % 5;
      const x = 76 + column * 554;
      const y = 266 + row * 64;
      const width = metric.value === null ? 0 : Math.round((metric.value / 100) * 360);
      const value = metric.value === null ? 'NOT MEASURED' : `${metric.value}`;
      return `<g><text x="${x}" y="${y}" class="label">${escapeSvg(metric.short.toUpperCase())}</text><text x="${x + 454}" y="${y}" class="value">${value}</text><rect x="${x}" y="${y + 14}" width="454" height="5" rx="2.5" fill="#282321"/><rect x="${x}" y="${y + 14}" width="${width}" height="5" rx="2.5" fill="#ff4d2e"/></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><style>.brand{font:700 22px Arial,sans-serif;fill:#f5f1ed}.name{font:700 48px Arial,sans-serif;fill:#f5f1ed}.meta{font:500 16px Arial,sans-serif;fill:#a49a93}.label{font:600 13px Arial,sans-serif;letter-spacing:1.5px;fill:#a49a93}.value{font:700 15px Arial,sans-serif;text-anchor:end;fill:#f5f1ed}.foot{font:500 13px Arial,sans-serif;fill:#756d68}</style><rect width="1200" height="675" fill="#0c0b0a"/><rect x="34" y="34" width="1132" height="607" fill="none" stroke="#3a312d"/><circle cx="78" cy="77" r="12" fill="none" stroke="#ff4d2e" stroke-width="3"/><text x="105" y="85" class="brand">openclasp / behaviour card</text><text x="76" y="160" class="name">${escapeSvg(model.name)}</text><text x="76" y="198" class="meta">${escapeSvg(humanize(model.taskCategory))} · ${escapeSvg(humanize(model.confidence))} confidence · ${model.evidenceCount} verified outcomes · v${escapeSvg(model.version)}</text><line x1="76" y1="228" x2="1124" y2="228" stroke="#3a312d"/>${metricRows}<line x1="76" y1="598" x2="1124" y2="598" stroke="#3a312d"/><text x="76" y="622" class="foot">STANDARD SCORECARD · SIGNED STRUCTURED OUTCOMES · RAW CONVERSATIONS EXCLUDED</text></svg>`;
}

function BehaviourScorecardDialog({
  open,
  onOpenChange,
  data,
  agent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DashboardData;
  agent?: Record<string, any>;
}) {
  const [actionState, setActionState] = useState('');
  useEffect(() => setActionState(''), [agent?.agentId]);
  if (!agent) return null;
  const model = scorecardForAgent(data, agent);
  const saveCard = () => {
    const blob = new Blob([scorecardSvg(model)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${model.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-openclasp-card.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
    setActionState('Downloaded');
  };
  const shareCard = async () => {
    const file = new File([scorecardSvg(model)], 'openclasp-behaviour-card.svg', {
      type: 'image/svg+xml',
    });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${model.name} behaviour card`, files: [file] });
        setActionState('Shared');
      } else {
        saveCard();
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError'))
        setActionState('Failed');
    }
  };
  const copyCard = async () => {
    try {
      await navigator.clipboard.writeText(scorecardSummary(model));
      setActionState('Copied');
    } catch {
      setActionState('Copy failed');
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scorecardDialog" showCloseButton>
        <DialogTitle className="scorecardA11yTitle">{model.name} behavioural scorecard</DialogTitle>
        <DialogDescription className="scorecardA11yTitle">
          Standard OpenClasp behavioural dimensions based on verified structured outcomes.
        </DialogDescription>
        <article className="behaviourScorecard">
          <header className="scorecardHeader">
            <div className="scorecardBrand">
              <ClaspMark />
              <span>openclasp / behaviour card</span>
            </div>
            <span className={model.verified ? 'scorecardVerified' : ''}>
              <ShieldCheck /> {model.verified ? 'Identity verified' : 'Identity unverified'}
            </span>
          </header>
          <div className="scorecardIdentity">
            <div>
              <p>STANDARD AGENT SCORECARD</p>
              <h2>{model.name}</h2>
            </div>
            <div className="scorecardContext">
              <span>{humanize(model.taskCategory)}</span>
              <span>{humanize(model.confidence)} confidence</span>
              <span>{model.evidenceCount} outcomes</span>
              <span>v{model.version}</span>
            </div>
          </div>
          <div className="scorecardMetrics">
            {model.metrics.map((metric) => (
              <div className={metric.value === null ? 'isUnmeasured' : ''} key={metric.key}>
                <span>
                  <strong>{metric.label}</strong>
                  <small>
                    {metric.value === null
                      ? 'Awaiting eligible evidence'
                      : `${metric.evidence.toFixed(1)} effective samples`}
                  </small>
                </span>
                <span className="scorecardMeter" aria-hidden="true">
                  <i style={{ width: `${metric.value ?? 0}%` }} />
                </span>
                <b>{metric.value === null ? '—' : metric.value}</b>
              </div>
            ))}
          </div>
          <footer className="scorecardFoot">
            <span>
              {model.trend === 'improving' ? '↗' : model.trend === 'declining' ? '↘' : '→'}{' '}
              {humanize(model.trend)} trend
            </span>
            <span>Updated {relativeTime(model.updatedAt)}</span>
            <small>Signed structured outcomes · raw conversations excluded</small>
          </footer>
        </article>
        <div className="scorecardActions">
          <span aria-live="polite">{actionState}</span>
          <button type="button" onClick={() => void copyCard()}>
            <Copy /> Copy summary
          </button>
          <button type="button" onClick={saveCard}>
            <Download /> Download
          </button>
          <button className="primary" type="button" onClick={() => void shareCard()}>
            <Share2 /> Share card
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function historyForAgent(data: DashboardData, agent: Record<string, any>): AgentHistoryItem[] {
  const agentId = String(agent.agentId);
  const interactions = new Map<string, Record<string, any>>();
  for (const interaction of [...data.interactions, ...data.federatedInteractions]) {
    const participants = [
      interaction.agentId,
      interaction.initiatorAgentId,
      interaction.responderAgentId,
      ...(interaction.contract?.parties ?? []),
    ];
    if (participants.includes(agentId))
      interactions.set(String(interaction.interactionId), interaction);
  }
  return [...interactions.values()]
    .map((interaction) => {
      const interactionId = String(interaction.interactionId);
      const report = [...data.completionReports]
        .reverse()
        .find((item) => item.interactionId === interactionId);
      const receipt = [...data.receipts]
        .reverse()
        .find((item) => item.interactionId === interactionId);
      const conclusion = [...data.interactionConclusions]
        .reverse()
        .find((item) => item.interactionId === interactionId);
      const thread = data.hostedThreads.find((item) => item.interactionId === interactionId);
      const counterpartId = interaction.initiatorAgentId
        ? interaction.initiatorAgentId === agentId
          ? interaction.responderAgentId
          : interaction.initiatorAgentId
        : (interaction.counterpartyAgentId ?? 'Local interaction');
      const counterpart =
        data.agents.find((item) => item.agentId === counterpartId)?.name ??
        (thread ? 'Temporary chat' : counterpartId);
      const counterpartMode: AgentHistoryItem['counterpartMode'] = thread ? 'temporary' : 'agent';
      const rawOutcome = String(
        conclusion?.lifecycle === 'provisional'
          ? 'provisional'
          : (conclusion?.outcome ??
              receipt?.outcome ??
              report?.outcome ??
              (interaction.status === 'completed' ? 'success' : (interaction.status ?? 'pending'))),
      );
      const outcome = (
        ['success', 'partial', 'failure', 'cancelled', 'provisional', 'active'].includes(rawOutcome)
          ? rawOutcome
          : 'pending'
      ) as AgentHistoryItem['outcome'];
      return {
        interactionId,
        title: String(interaction.contract?.purpose ?? interaction.purpose ?? 'Interaction'),
        counterpart: String(counterpart),
        counterpartMode,
        outcome,
        at: String(
          report?.completedAt ??
            receipt?.issuedAt ??
            conclusion?.concludedAt ??
            interaction.completedAt ??
            interaction.updatedAt ??
            interaction.createdAt ??
            new Date().toISOString(),
        ),
      };
    })
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

function OutcomeSymbol({ outcome }: { outcome: AgentHistoryItem['outcome'] }) {
  if (outcome === 'success')
    return (
      <span className="outcomeSymbol success">
        <Check />
      </span>
    );
  if (outcome === 'failure' || outcome === 'cancelled')
    return (
      <span className="outcomeSymbol failure">
        <X />
      </span>
    );
  if (outcome === 'partial' || outcome === 'provisional')
    return <span className="outcomeSymbol partial">½</span>;
  return (
    <span className="outcomeSymbol pending">
      <Circle />
    </span>
  );
}

function Marketplace({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState(() =>
    String(data.agents[0]?.agentId ?? ''),
  );
  const [taskCategory, setTaskCategory] = useState(() =>
    String(data.agents[0]?.capabilities?.[0] ?? 'general'),
  );
  const [results, setResults] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ limit: '50' });
      if (query.trim()) parameters.set('query', query.trim());
      if (selectedAgentId) parameters.set('agentId', selectedAgentId);
      if (taskCategory.trim()) parameters.set('taskCategory', taskCategory.trim());
      remoteApi(`/v0.1/marketplace?${parameters}`, { signal: controller.signal })
        .then((result) => setResults(result as Record<string, any>[]))
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : 'Directory unavailable');
          setResults(
            data.agents
              .filter((agent) =>
                data.publications.some(
                  (publication) => publication.agentId === agent.agentId && publication.published,
                ),
              )
              .filter((agent) =>
                `${agent.name} ${agent.description} ${(agent.capabilities ?? []).join(' ')}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((card) => ({
                card,
                taskCategory,
                match: {
                  score: 0.5,
                  label: 'possible',
                  reasons: ['Preview capability match', 'No verified private history'],
                },
                contextualReliability: data.intelligenceSummaries.find(
                  (summary) =>
                    summary.agentId === card.agentId &&
                    summary.taskCategory.toLowerCase() === taskCategory.toLowerCase(),
                ),
              })),
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    data.agents,
    data.intelligenceSummaries,
    data.publications,
    query,
    selectedAgentId,
    taskCategory,
  ]);

  return (
    <div className="workspacePage marketplacePage">
      <header className="workspaceHead marketplaceHead">
        <div>
          <p className="eyebrow">public directory</p>
          <h1>Marketplace</h1>
          <p>Find verified agents ready to work.</p>
        </div>
        <div className="marketFilters">
          <label>
            <span>For</span>
            <select
              value={selectedAgentId}
              onChange={(event) => {
                const agentId = event.target.value;
                const agent = data.agents.find((item) => item.agentId === agentId);
                setSelectedAgentId(agentId);
                setTaskCategory(String(agent?.capabilities?.[0] ?? 'general'));
                setLoading(true);
              }}
            >
              {data.agents.map((agent) => (
                <option value={agent.agentId} key={agent.agentId}>
                  {agent.name ?? agent.agentId}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Task</span>
            <input
              value={taskCategory}
              onChange={(event) => {
                setTaskCategory(event.target.value);
                setLoading(true);
              }}
              placeholder="procurement"
            />
          </label>
          <label className="marketSearch">
            <Search />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setLoading(true);
                setError('');
                setQuery(event.target.value);
              }}
              placeholder="Search agents"
            />
          </label>
        </div>
      </header>
      <div className="marketContext">
        Recommendations combine public capabilities with your private, verified history. Scores are
        task-specific and confidence-adjusted.
      </div>
      {error && !results.length ? <div className="errorBar">{error}</div> : null}
      <section className="marketGrid" aria-live="polite">
        {loading ? (
          Array.from({ length: 6 }, (_, index) => <div className="marketSkeleton" key={index} />)
        ) : results.length ? (
          results.map((result) => {
            const agent = result.card;
            const online = agent.presence?.status === 'online';
            const temporary = agent.agentMode === 'temporary_chat';
            const intelligence = result.contextualReliability;
            return (
              <article className="marketCard" key={agent.agentId}>
                <div className="marketCardTop">
                  <span className="agentAvatar">
                    <Bot />
                    <i className={online ? 'online' : ''} />
                  </span>
                  <span className={online ? 'marketPresence online' : 'marketPresence'}>
                    {online ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className={`matchBadge ${result.match.label}`}>
                  <strong>{Math.round(Number(result.match.score) * 100)}%</strong>
                  <span>
                    {result.match.label} match for {result.taskCategory}
                  </span>
                </div>
                <h2>{agent.name}</h2>
                <p>{agent.description || 'Public OpenClasp agent'}</p>
                <div className="marketTags">
                  {(agent.capabilities ?? []).slice(0, 4).map((capability: string) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
                <div className="marketMeta">
                  <span>
                    <ShieldCheck /> Verified
                  </span>
                  <span>
                    {temporary ? <MessageCircle /> : <Cloud />} {temporary ? 'Temporary' : 'Cloud'}
                  </span>
                </div>
                <div className="marketIntelligence">
                  {intelligence ? (
                    <>
                      <strong>{Math.round(Number(intelligence.score) * 100)}%</strong>
                      <span>
                        contextual reliability · {intelligence.confidence.level} confidence ·{' '}
                        {intelligence.confidence.evidenceCount} outcomes
                      </span>
                    </>
                  ) : (
                    <span>No verified history for this task</span>
                  )}
                </div>
                <a
                  className="marketProfileLink"
                  href={agent.profileUrl ?? `/a/${encodeURIComponent(String(agent.agentId))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View agent <ArrowRight />
                </a>
              </article>
            );
          })
        ) : (
          <div className="quietEmpty marketEmpty">No matching public agents</div>
        )}
      </section>
    </div>
  );
}

function Overview({
  data,
  navigate,
  refreshDashboard,
  api,
}: {
  data: DashboardData;
  navigate: (page: Page) => void;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const completed = data.receipts.filter((item) => item.outcome === 'success').length;
  const warnings = data.events.filter((item) =>
    ['policy_warning', 'policy_violation', 'objection'].includes(String(item.eventType)),
  ).length;
  const publishedIds = new Set(
    data.publications
      .filter((publication) => publication.published)
      .map((publication) => String(publication.agentId)),
  );
  const runtimeIds = new Set(
    data.runtimes
      .filter((runtime) => runtime.status === 'verified')
      .map((runtime) => String(runtime.agentId)),
  );
  const modeOf = (agent: Record<string, any>) =>
    agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat');
  const readyAgents = data.agents.filter(
    (agent) =>
      publishedIds.has(String(agent.agentId)) &&
      (modeOf(agent) === 'temporary_chat' || runtimeIds.has(String(agent.agentId))),
  ).length;
  const activeTemporaryChats = data.agents.filter(
    (agent) => modeOf(agent) === 'temporary_chat' && agent.presence?.status === 'online',
  ).length;
  const pendingInvitations = data.federatedInteractions.filter(
    (interaction) => interaction.status === 'pending',
  ).length;
  const pendingFeedback = data.feedbackRequests.filter(
    (request) => request.status === 'pending',
  ).length;
  const pendingSetup = data.setupRequests.filter((request) => request.status === 'pending').length;
  const reviewCount = warnings + pendingInvitations + pendingFeedback;
  return (
    <>
      <PageHead page="dashboard" action="Connect agent" onAction={() => navigate('connect')} />
      {pendingSetup > 0 && (
        <button className="attentionBanner" type="button" onClick={() => navigate('connect')}>
          <div>
            <span className="statusIndex">//</span>
            <div>
              <strong>
                {pendingSetup} setup request{pendingSetup === 1 ? '' : 's'} waiting
              </strong>
            </div>
          </div>
        </button>
      )}
      {!(readyAgents === data.agents.length && readyAgents) && (
        <section className="readiness">
          <div>
            <span className="statusIndex">!</span>
            <div>
              <strong>
                {readyAgents} of {data.agents.length} agents can receive A2A work
              </strong>
            </div>
          </div>
          <button className="secondary" type="button" onClick={() => navigate('agents')}>
            Manage
          </button>
        </section>
      )}
      <section className="metrics">
        <Metric
          label="Active temporary chats"
          value={activeTemporaryChats}
          note={`${runtimeIds.size} persistent runtimes connected`}
        />
        <Metric
          label="Interactions"
          value={data.interactions.length + data.federatedInteractions.length}
          note="local and shared"
        />
        <Metric label="Successful outcomes" value={completed} note="receipt-backed" />
        <Metric
          label="Needs review"
          value={reviewCount}
          note={`${pendingFeedback} feedback · ${pendingInvitations} invitations`}
          warn={reviewCount > 0}
        />
      </section>
      <Invitations data={data} refreshDashboard={refreshDashboard} api={api} />
      <section className="contentGrid">
        <Panel title="Recent activity" subtitle="">
          <Timeline events={data.events.slice(-6).reverse()} />
          <TextButton onClick={() => navigate('history')}>All history</TextButton>
        </Panel>
        <Panel title="Reliability" subtitle="">
          {data.profiles.length ? (
            data.profiles.slice(0, 4).map((profile) => {
              const deltas = data.profileDeltas.filter(
                (delta) =>
                  delta.agentId === profile.agentId &&
                  delta.agentVersion === profile.agentVersion &&
                  delta.taskCategory === profile.taskCategory,
              );
              return (
                <Profile
                  key={`${profile.agentId}-${profile.agentVersion}-${profile.taskCategory}`}
                  profile={profile}
                  deltas={deltas}
                />
              );
            })
          ) : (
            <Empty
              title="No reliability profile yet"
              text="Profiles appear after signed receipts and eligible bilateral feedback."
            />
          )}
        </Panel>
      </section>
    </>
  );
}

function Conversations({
  data,
  refreshDashboard,
  api,
}: {
  data: DashboardData;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const temporaryAgentFor = (thread: Record<string, any>) =>
    data.agents.find(
      (agent) =>
        thread.participantAgentIds?.includes(agent.agentId) &&
        (agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat')) ===
          'temporary_chat',
    );
  const openThread = async (thread: Record<string, any>) => {
    const agent = temporaryAgentFor(thread);
    if (!agent) return;
    setWorking(true);
    setError('');
    try {
      const [detail] = (await Promise.all([
        api(
          `/v0.1/agents/${encodeURIComponent(agent.agentId)}/threads/${encodeURIComponent(thread.threadId)}`,
        ),
        api(
          `/v0.1/agents/${encodeURIComponent(agent.agentId)}/threads/${encodeURIComponent(thread.threadId)}/read`,
          { method: 'POST' },
        ),
      ])) as [Record<string, any>, unknown];
      setSelected(detail);
      setSelectedAgentId(String(agent.agentId));
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open conversation');
    } finally {
      setWorking(false);
    }
  };
  const reply = async () => {
    if (!selected || !draft.trim() || !selectedAgentId) return;
    setWorking(true);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(selectedAgentId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          interactionId: selected.thread.interactionId,
          content: draft.trim(),
        }),
      });
      setDraft('');
      await openThread(selected.thread);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send reply');
      setWorking(false);
    }
  };
  return (
    <>
      <PageHead page="conversations" />
      <div className="notice">
        <strong>Temporary only.</strong> Encrypted 30 days. Persistent runtime messages stay direct.
      </div>
      {error ? (
        <div className="errorBar" role="alert">
          {error}
        </div>
      ) : null}
      <section className="conversationLayout">
        <Panel title="Threads" subtitle="Temporary chat identities only">
          <div className="threadList">
            {data.hostedThreads.length ? (
              data.hostedThreads.map((thread) => {
                const agent = temporaryAgentFor(thread);
                const peer = thread.participantAgentIds?.find(
                  (value: string) => value !== agent?.agentId,
                );
                return (
                  <button
                    type="button"
                    key={thread.threadId}
                    className={selected?.thread?.threadId === thread.threadId ? 'active' : ''}
                    onClick={() => void openThread(thread)}
                    disabled={working}
                  >
                    <span>
                      <strong>{peer ?? 'Counterparty'}</strong>
                      <small>{agent?.name ?? agent?.agentId}</small>
                    </span>
                    <b>{thread.unreadCount ? `${thread.unreadCount} NEW` : thread.status}</b>
                  </button>
                );
              })
            ) : (
              <Empty
                title="No temporary conversations"
                text="Messages appear after a temporary chat identity accepts an interaction with a persistent runtime."
              />
            )}
          </div>
        </Panel>
        <Panel
          title={selected ? 'Conversation' : 'Select a thread'}
          subtitle="Private insights are attributable and task-specific"
        >
          {selected ? (
            <div className="conversationDetail">
              {!!selected.insights?.length && (
                <div className="conversationInsights">
                  {selected.insights.map((insight: Record<string, any>) => (
                    <p key={insight.code}>
                      <b>{String(insight.severity).toUpperCase()}</b> {insight.message}
                    </p>
                  ))}
                </div>
              )}
              <div className="messageList">
                {selected.messages.map((message: Record<string, any>) => (
                  <article
                    key={message.messageId}
                    className={message.senderAgentId === selectedAgentId ? 'sent' : 'received'}
                  >
                    <small>{message.senderAgentId === selectedAgentId ? 'You' : 'Peer'}</small>
                    <p>{message.content}</p>
                    <span>{new Date(message.createdAt).toLocaleString()}</span>
                  </article>
                ))}
              </div>
              <div className="replyBox">
                <textarea
                  aria-label="Temporary chat reply"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={20_000}
                  placeholder="Reply through the temporary OpenClasp A2A adapter"
                />
                <button
                  className="primary"
                  type="button"
                  disabled={working || !draft.trim() || selected.thread.status !== 'open'}
                  onClick={() => void reply()}
                >
                  {working ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </div>
          ) : (
            <Empty title="Nothing selected" text="Choose a thread to read its hosted history." />
          )}
        </Panel>
      </section>
    </>
  );
}

function History({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<
    'all' | 'pending' | 'active' | 'provisional' | 'finalizing' | 'completed'
  >('all');
  const journeys = useMemo(() => interactionJourneys(data), [data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return journeys.filter((journey) => {
      if (status !== 'all' && journey.status !== status) return false;
      if (!needle) return true;
      const hay = [
        journey.interactionId,
        journey.purpose,
        journey.taskCategory,
        journey.status,
        ...journey.participants,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [journeys, query, status]);
  const [selectedId, setSelectedId] = useState('');
  const selected = filtered.find((journey) => journey.interactionId === selectedId) ?? filtered[0];
  return (
    <>
      <PageHead page="history" />
      <div className="historyToolbar">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search purpose, category, or agent"
          aria-label="Search interaction history"
          className="h-9 min-w-[220px] flex-1 rounded-none border-0 border-b bg-transparent px-0 shadow-none dark:bg-transparent"
        />
        <Tabs
          value={status === 'finalizing' ? 'all' : status}
          onValueChange={(value) =>
            setStatus(value as 'all' | 'pending' | 'active' | 'provisional' | 'completed')
          }
        >
          <TabsList variant="line" aria-label="Interaction status filters">
            {(['all', 'pending', 'active', 'provisional', 'completed'] as const).map((value) => (
              <TabsTrigger key={value} value={value} className="capitalize">
                {value}
                <span className="font-mono text-[10px] text-muted-foreground">
                  {value === 'all'
                    ? journeys.length
                    : journeys.filter((item) => item.status === value).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {filtered.length ? (
        <section className="journeyLayout">
          <div className="journeyList" aria-label="Interactions">
            {filtered.map((journey) => (
              <button
                key={journey.interactionId}
                className={selected?.interactionId === journey.interactionId ? 'active' : ''}
                type="button"
                onClick={() => {
                  setSelectedId(journey.interactionId);
                  if (matchMedia('(max-width: 980px)').matches)
                    requestAnimationFrame(() =>
                      document
                        .querySelector('.journeyDetail')
                        ?.scrollIntoView({ behavior: 'smooth' }),
                    );
                }}
              >
                <span className="journeyListTop">
                  <b>{journey.taskCategory}</b>
                  <StatusPill value={journey.status} />
                </span>
                <strong>{journey.purpose}</strong>
                <small>{journey.participants.join(' ↔ ') || 'Participants unavailable'}</small>
                <span className="journeyListMeta">
                  {relativeTime(journey.updatedAt)}
                  <i>{journey.stepCount} recorded steps</i>
                </span>
              </button>
            ))}
          </div>
          {selected ? <InteractionJourney journey={selected} /> : null}
        </section>
      ) : (
        <section className="panel">
          <Empty
            title={journeys.length ? 'No matching interactions' : 'No interactions recorded'}
            text={
              journeys.length
                ? 'Clear the search or choose another status.'
                : 'Completed contracts, outcomes, feedback, and learning will appear as one readable journey.'
            }
          />
        </section>
      )}
    </>
  );
}

type InteractionJourneyModel = {
  interactionId: string;
  purpose: string;
  taskCategory: string;
  status: string;
  participants: string[];
  updatedAt: string;
  stepCount: number;
  interaction: Record<string, any>;
  session?: Record<string, any>;
  events: Record<string, any>[];
  briefs: Record<string, any>[];
  reports: Record<string, any>[];
  feedbackRequests: Record<string, any>[];
  feedback: Record<string, any>[];
  conclusion?: Record<string, any>;
  receipt?: Record<string, any>;
  eligibility?: Record<string, any>;
  deltas: Record<string, any>[];
  conflicts: Record<string, any>[];
};

function interactionJourneys(data: DashboardData): InteractionJourneyModel[] {
  const ids = new Set<string>();
  const collections = [
    data.interactions,
    data.federatedInteractions,
    data.liveSessions,
    data.events,
    data.counterpartyBriefs,
    data.completionReports,
    data.feedbackRequests,
    data.interactionFeedback,
    data.interactionConclusions,
    data.receipts,
    data.learningEligibility,
    data.profileDeltas,
    data.conflicts,
  ];
  for (const collection of collections)
    for (const item of collection) if (item.interactionId) ids.add(String(item.interactionId));
  return [...ids]
    .map((interactionId) => {
      const interaction = data.federatedInteractions.find(
        (item) => item.interactionId === interactionId,
      ) ??
        data.interactions.find((item) => item.interactionId === interactionId) ?? { interactionId };
      const session = data.liveSessions.find((item) => item.interactionId === interactionId);
      const events = data.events.filter((item) => item.interactionId === interactionId);
      const briefs = data.counterpartyBriefs.filter((item) => item.interactionId === interactionId);
      const reports = data.completionReports.filter((item) => item.interactionId === interactionId);
      const feedbackRequests = data.feedbackRequests.filter(
        (item) => item.interactionId === interactionId,
      );
      const feedback = data.interactionFeedback.filter(
        (item) => item.interactionId === interactionId,
      );
      const conclusion = data.interactionConclusions.find(
        (item) => item.interactionId === interactionId,
      );
      const receipt = data.receipts.find((item) => item.interactionId === interactionId);
      const eligibility = data.learningEligibility.find(
        (item) => item.interactionId === interactionId,
      );
      const deltas = data.profileDeltas.filter((item) => item.interactionId === interactionId);
      const conflicts = data.conflicts.filter((item) => item.interactionId === interactionId);
      const participants = [
        interaction.initiatorAgentId,
        interaction.responderAgentId,
        interaction.agentId,
        ...reports.flatMap((report) => [report.reportingAgentId, report.counterpartyAgentId]),
      ]
        .filter((value): value is string => typeof value === 'string' && Boolean(value))
        .filter((value, index, values) => values.indexOf(value) === index);
      const dates = [
        interaction.updatedAt,
        interaction.createdAt,
        session?.completedAt,
        session?.activatedAt,
        ...events.map(timestamp),
        ...reports.map(timestamp),
        ...feedback.map(timestamp),
        conclusion?.generatedAt,
        receipt?.completedAt,
        eligibility?.decidedAt,
      ].filter((value): value is string => typeof value === 'string');
      return {
        interactionId,
        purpose: String(
          interaction.contract?.purpose ??
            interaction.contract?.requestedOutcome ??
            conclusion?.summary ??
            'Assured agent interaction',
        ),
        taskCategory: String(interaction.contract?.taskCategory ?? 'general'),
        status: String(
          conclusion || receipt
            ? conclusion?.lifecycle === 'provisional' || receipt?.provisional
              ? 'provisional'
              : 'completed'
            : reports.length > 0
              ? 'finalizing'
              : (session?.status ?? interaction.status ?? 'pending'),
        ),
        participants,
        updatedAt:
          dates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ??
          new Date(0).toISOString(),
        stepCount:
          1 +
          Math.max(0, Number(interaction.contractRevisions?.length ?? 0) - 1) +
          events.length +
          briefs.length +
          reports.length +
          feedbackRequests.length +
          feedback.length +
          conflicts.length +
          Number(Boolean(conclusion)) +
          Number(Boolean(receipt)) +
          Number(Boolean(eligibility)) +
          deltas.length,
        interaction,
        ...(session ? { session } : {}),
        events,
        briefs,
        reports,
        feedbackRequests,
        feedback,
        ...(conclusion ? { conclusion } : {}),
        ...(receipt ? { receipt } : {}),
        ...(eligibility ? { eligibility } : {}),
        deltas,
        conflicts,
      };
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function InteractionJourney({ journey }: { journey: InteractionJourneyModel }) {
  const timeline = interactionTimeline(journey);
  const conclusion = journey.conclusion;
  const checkpoints = journey.events.filter(
    (event) => (event.type ?? event.eventType) === 'progress_checkpoint' && event.checkpoint,
  );
  const latestCheckpoint = checkpoints.at(-1)?.checkpoint;
  const progress = Number(latestCheckpoint?.progress ?? 0);
  const submittedFeedback = new Set(
    journey.feedback.map((item) => item.reviewerAgentId).filter(Boolean),
  ).size;
  return (
    <article className="journeyDetail">
      <header className="journeyHero">
        <div>
          <span className="eyebrow">{journey.taskCategory}</span>
          <h2>{journey.purpose}</h2>
          <p>{journey.participants.join(' ↔ ')}</p>
        </div>
        <StatusPill value={conclusion?.outcome ?? journey.status} />
      </header>

      <div className="journeySummaryGrid">
        <section>
          <span>Progress</span>
          <strong>
            {latestCheckpoint
              ? `${Math.round(progress * 100)}% · ${humanize(latestCheckpoint.state)}`
              : journey.reports.length
                ? 'One side ended'
                : 'Awaiting checkpoint'}
          </strong>
          <small>
            {latestCheckpoint
              ? `${humanize(latestCheckpoint.topicStatus)} · ${Math.round(Number(latestCheckpoint.confidence ?? 0) * 100)}% confidence`
              : 'Agents report compact progress every few exchanges'}
          </small>
        </section>
        <section>
          <span>Outcome</span>
          <strong>
            {conclusion
              ? humanize(conclusion.outcome)
              : `${journey.reports.length}/2 terminal reports`}
          </strong>
          <small>
            {conclusion
              ? conclusion.lifecycle === 'provisional'
                ? `${Math.round(Number(conclusion.confidence ?? 0) * 100)}% confidence · peer ${humanize(conclusion.peerReportStatus ?? 'awaiting').toLowerCase()}`
                : humanize(conclusion.consensus)
              : journey.reports.length === 1
                ? 'One agent finished; confirming with the peer'
                : 'Conversation remains active'}
          </small>
        </section>
        <section>
          <span>Sealed feedback</span>
          <strong>
            {journey.feedbackRequests.some((request) => request.status === 'pending')
              ? `${submittedFeedback}/2 sealed`
              : 'Window closed'}
          </strong>
          <small>{feedbackState(journey.feedbackRequests)}</small>
        </section>
        <section>
          <span>Learning</span>
          <strong>
            {journey.eligibility
              ? journey.eligibility.eligible
                ? `${Math.round(Number(journey.eligibility.sampleWeight ?? 0) * 100)}% weight`
                : 'Not eligible'
              : conclusion?.lifecycle === 'provisional'
                ? 'Pending corroboration'
                : 'Not assessed'}
          </strong>
          <small>{humanize(journey.eligibility?.contributionMode ?? 'Local only')}</small>
        </section>
      </div>

      {latestCheckpoint ? (
        <section className="progressCard">
          <div className="progressCardTop">
            <div>
              <span className="eyebrow">LATEST PRIVATE CHECKPOINT</span>
              <h3>{humanize(latestCheckpoint.state)}</h3>
            </div>
            <strong>{Math.round(progress * 100)}%</strong>
          </div>
          <div
            className="progressTrack"
            role="progressbar"
            aria-label="Interaction progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="progressFacts">
            <span>{latestCheckpoint.criteriaMet?.length ?? 0} criteria met</span>
            <span>{latestCheckpoint.criteriaRemaining?.length ?? 0} remaining</span>
            <span>{latestCheckpoint.expectedRemainingTurns ?? '—'} expected turns</span>
            <span>
              {latestCheckpoint.needsHuman ? 'Human input needed' : 'No human input needed'}
            </span>
          </div>
          {latestCheckpoint.topicStatus !== 'in_scope' ? (
            <p className="progressWarning">
              Topic {humanize(latestCheckpoint.topicStatus)}. Amend the contract or start a new
              interaction before continuing.
            </p>
          ) : null}
        </section>
      ) : null}

      {conclusion ? (
        <section className="outcomeCard">
          <div>
            <span className="eyebrow">
              {conclusion.lifecycle === 'provisional' ? 'PROVISIONAL INSIGHT' : 'WHAT HAPPENED'}
            </span>
            <h3>{conclusion.summary}</h3>
            {conclusion.lifecycle === 'provisional' ? (
              <p className="progressWarning">
                Based on {conclusion.reportIds?.length ?? 1} participant report. Missing:{' '}
                {(conclusion.missingReportAgentIds ?? []).join(', ') || 'peer report'}. This is
                usable now at reduced confidence and will be revised if the peer responds.
              </p>
            ) : null}
          </div>
          {!!conclusion.criteria?.length && (
            <ul>
              {conclusion.criteria.map((criterion: Record<string, any>) => (
                <li key={criterion.criterion}>
                  <StatusPill value={String(criterion.status)} />
                  <span>{criterion.criterion}</span>
                </li>
              ))}
            </ul>
          )}
          {!!Object.keys(conclusion.averageRatings ?? {}).length && (
            <div className="ratingGrid">
              {Object.entries(conclusion.averageRatings).map(([label, value]) => (
                <Meter key={label} label={humanize(label)} value={Number(value)} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="journeyNotice">
          {journey.reports.length === 1
            ? 'Finalizing: one agent submitted its terminal report. OpenClasp has requested independent confirmation from the peer.'
            : journey.reports.length >= 2
              ? 'Both agents finished. Sealed feedback remains private until both respond or the feedback window expires.'
              : 'Active interaction. Progress checkpoints appear after several meaningful exchanges; either agent can finalize immediately when the task is done.'}
        </div>
      )}

      <section className="journeyTimelineSection">
        <div>
          <h3>Interaction timeline</h3>
          <small>Contract → session → outcome → feedback → learning</small>
        </div>
        <ol className="journeyTimeline">
          {timeline.map((step, index) => (
            <li key={`${step.at}-${step.title}-${index}`}>
              <span className={`journeyNode ${step.tone}`} />
              <div>
                <span>{formatDate(step.at)}</span>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
              <StatusPill value={step.status} />
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function interactionTimeline(journey: InteractionJourneyModel) {
  const revisions = journey.interaction.contractRevisions ?? [];
  const contractSteps = revisions.length
    ? revisions.map((revision: Record<string, any>) => ({
        at: String(revision.updatedAt ?? revision.createdAt ?? journey.interaction.createdAt),
        title: `Contract v${revision.revision} ${humanize(revision.status)}`,
        detail: `${revision.proposedByAgentId} · ${Object.keys(revision.acceptances ?? {}).length}/${journey.participants.length || 2} accepted · ${String(revision.termsHash).slice(0, 12)}…`,
        status: String(revision.status),
        tone:
          revision.status === 'accepted'
            ? 'good'
            : revision.status === 'rejected'
              ? 'danger'
              : revision.status === 'proposed'
                ? 'warn'
                : 'neutral',
      }))
    : [
        {
          at: String(journey.interaction.createdAt ?? journey.updatedAt),
          title: 'Contract proposed',
          detail: `${journey.participants.length || 2} participants · ${journey.taskCategory}`,
          status: String(journey.interaction.status ?? 'recorded'),
          tone: 'neutral',
        },
        ...Object.values(journey.interaction.acceptances ?? {}).map((acceptance: any) => ({
          at: String(acceptance.acceptedAt ?? journey.interaction.updatedAt ?? journey.updatedAt),
          title: `Contract accepted by ${acceptance.agentId}`,
          detail: `Acceptance method: ${humanize(acceptance.method ?? 'recorded')}`,
          status: 'accepted',
          tone: 'good',
        })),
      ];
  const steps: { at: string; title: string; detail: string; status: string; tone: string }[] = [
    ...contractSteps,
    ...journey.briefs.map((brief) => ({
      at: String(brief.generatedAt ?? journey.updatedAt),
      title: `Private counterparty brief for ${brief.recipientAgentId}`,
      detail: `${brief.relevantSampleSize ?? 0} relevant samples · ${Math.round(Number(brief.historyConfidence ?? 0) * 100)}% history confidence`,
      status: String(brief.decision ?? 'ready'),
      tone: brief.decision === 'DENY' ? 'danger' : brief.decision === 'CHALLENGE' ? 'warn' : 'good',
    })),
    ...(journey.session?.activatedAt
      ? [
          {
            at: String(journey.session.activatedAt),
            title: 'A2A session activated',
            detail:
              'Scoped credentials were issued. Persistent runtimes exchange content directly; temporary mode uses the hosted adapter.',
            status: 'active',
            tone: 'good',
          },
        ]
      : []),
    ...journey.events.map((event) => {
      const eventType = String(event.type ?? event.eventType ?? 'structured_event');
      const checkpoint = event.checkpoint;
      return {
        at: timestamp(event),
        title:
          eventType === 'progress_checkpoint'
            ? `${Math.round(Number(checkpoint?.progress ?? 0) * 100)}% progress checkpoint`
            : humanize(eventType),
        detail:
          eventType === 'progress_checkpoint'
            ? `${event.agentId} · ${humanize(checkpoint?.state ?? 'active')} · ${humanize(checkpoint?.topicStatus ?? 'in_scope')}`
            : String(event.agentId ?? 'OpenClasp') + ' submitted structured metadata.',
        status: String(checkpoint?.state ?? event.visibility ?? 'recorded'),
        tone:
          checkpoint?.topicStatus === 'changed' || checkpoint?.state === 'blocked'
            ? 'warn'
            : eventType.includes('violation')
              ? 'danger'
              : eventType.includes('warning')
                ? 'warn'
                : checkpoint
                  ? 'good'
                  : 'neutral',
      };
    }),
    ...journey.reports.map((report) => ({
      at: timestamp(report),
      title: `Completion reported by ${report.reportingAgentId}`,
      detail: String(report.summary ?? 'Structured completion report submitted.'),
      status: String(report.outcome ?? 'reported'),
      tone:
        report.outcome === 'failure' ? 'danger' : report.outcome === 'partial' ? 'warn' : 'good',
    })),
    ...journey.feedback.map((item) => ({
      at: timestamp(item),
      title: `Feedback submitted by ${item.reviewerAgentId}`,
      detail: `Would work again: ${humanize(item.wouldWorkAgain ?? 'unsure')} · private comment concealed`,
      status: 'sealed',
      tone: 'neutral',
    })),
    ...journey.feedbackRequests
      .filter((request) => request.status !== 'submitted')
      .map((request) => ({
        at: String(request.requestedAt ?? journey.updatedAt),
        title: `Feedback request ${humanize(request.status)}`,
        detail:
          request.status === 'pending'
            ? `Response due ${formatDate(String(request.dueAt))}`
            : 'The bilateral conclusion continued without this response.',
        status: String(request.status),
        tone: request.status === 'pending' ? 'warn' : 'neutral',
      })),
    ...journey.conflicts.map((conflict) => ({
      at: timestamp(conflict),
      title: 'Dispute recorded',
      detail: String(conflict.summary ?? 'The interaction has a structured dispute record.'),
      status: String(conflict.status ?? 'open'),
      tone: conflict.status === 'resolved' ? 'good' : 'danger',
    })),
    ...(journey.conclusion
      ? [
          {
            at: String(journey.conclusion.generatedAt),
            title:
              journey.conclusion.lifecycle === 'provisional'
                ? 'Provisional insight generated'
                : 'Conclusion released',
            detail: String(journey.conclusion.summary),
            status: String(journey.conclusion.consensus),
            tone:
              journey.conclusion.lifecycle === 'provisional' ||
              journey.conclusion.consensus === 'conflicting'
                ? 'warn'
                : 'good',
          },
        ]
      : []),
    ...(journey.receipt
      ? [
          {
            at: timestamp(journey.receipt),
            title: journey.receipt.provisional
              ? 'Provisional outcome attested'
              : 'Outcome receipt attested',
            detail: journey.receipt.provisional
              ? 'The available one-sided report was sealed without claiming peer agreement.'
              : 'Contract result, commitment status, and evidence hashes were sealed.',
            status: String(journey.receipt.outcome ?? 'signed'),
            tone: journey.receipt.outcome === 'failure' ? 'danger' : 'good',
          },
        ]
      : []),
    ...(journey.eligibility
      ? [
          {
            at: String(journey.eligibility.decidedAt),
            title: journey.eligibility.eligible
              ? 'Eligible history applied'
              : 'History excluded from profile',
            detail: `${Math.round(Number(journey.eligibility.sampleWeight ?? 0) * 100)}% sample weight · ${humanize(journey.eligibility.contributionMode)}`,
            status: journey.eligibility.eligible ? 'attested' : 'excluded',
            tone: journey.eligibility.eligible ? 'good' : 'warn',
          },
        ]
      : []),
  ];
  return steps.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function Agents({
  data,
  navigate,
  refreshDashboard,
  api,
}: {
  data: DashboardData;
  navigate: (page: Page) => void;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const saveAutomation = async (
    agentId: string,
    value: {
      autoPublish: boolean;
      autoAcceptPolicy: 'off' | 'safe_matching';
      autoAcceptTaskCategories: string[];
    },
  ) => {
    setWorking(agentId);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(agentId)}/automation`, {
        method: 'PUT',
        body: JSON.stringify(value),
      });
      await refreshDashboard();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Directory update failed');
      return false;
    } finally {
      setWorking('');
    }
  };
  const saveRuntime = async (agentId: string, endpoint: string) => {
    setWorking(`runtime:${agentId}`);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(agentId)}/runtime`, {
        method: 'PUT',
        body: JSON.stringify({ endpoint }),
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Runtime verification failed');
    } finally {
      setWorking('');
    }
  };
  const disableRuntime = async (agentId: string) => {
    setWorking(`runtime:${agentId}`);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(agentId)}/runtime`, { method: 'DELETE' });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Runtime update failed');
    } finally {
      setWorking('');
    }
  };
  const revokeAccessToken = async (agentId: string, tokenId: string) => {
    setWorking(`token:${agentId}`);
    setError('');
    try {
      await api(
        `/v0.1/agents/${encodeURIComponent(agentId)}/access-tokens/${encodeURIComponent(tokenId)}`,
        { method: 'DELETE' },
      );
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke agent access token');
    } finally {
      setWorking('');
    }
  };
  const deleteAgent = async (agent: Record<string, any>) => {
    const agentId = String(agent.agentId);
    if (
      !window.confirm(
        `Delete “${String(agent.name ?? agentId)}”?\n\nIts runtime, publication, presence, MCP binding and hosted temporary messages will be removed. Signed interaction and receipt history will be retained.`,
      )
    )
      return;
    setWorking(`delete:${agentId}`);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent deletion failed');
    } finally {
      setWorking('');
    }
  };
  return (
    <>
      <PageHead page="agents" action="Connect agent" onAction={() => navigate('connect')} />
      <div className="notice">
        <strong>Two explicit modes.</strong> Persistent runtimes talk directly over A2A. Temporary
        chats use an OpenClasp-hosted endpoint with encrypted-at-rest history. There is no offline
        relay for persistent runtimes.
      </div>
      {error && (
        <div className="errorBar" role="alert">
          {error}
        </div>
      )}
      <section className="agentGrid">
        {data.agents.length ? (
          data.agents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agent={agent}
              projectName={
                data.projects.find((project) => project.projectId === agent.projectId)?.name
              }
              published={data.publications.some(
                (publication) => publication.agentId === agent.agentId && publication.published,
              )}
              working={working === agent.agentId}
              onSave={(value) => saveAutomation(agent.agentId, value)}
              runtime={data.runtimes.find((runtime) => runtime.agentId === agent.agentId)}
              runtimeWorking={working === `runtime:${agent.agentId}`}
              deleteWorking={working === `delete:${agent.agentId}`}
              onRuntime={(endpoint) => saveRuntime(agent.agentId, endpoint)}
              onDisableRuntime={() => disableRuntime(agent.agentId)}
              accessTokens={data.accessTokens.filter(
                (token) =>
                  token.agentId === agent.agentId &&
                  !token.revokedAt &&
                  Date.parse(String(token.expiresAt)) > Date.now(),
              )}
              accessTokenWorking={working === `token:${agent.agentId}`}
              onRevokeAccessToken={(tokenId) => revokeAccessToken(agent.agentId, tokenId)}
              onDelete={() => deleteAgent(agent)}
            />
          ))
        ) : (
          <Empty
            title="No agents connected"
            text="Install the remote MCP endpoint in an agent, sign in, then create and register its identity."
            action="Open connection guide"
            onAction={() => navigate('connect')}
          />
        )}
      </section>
    </>
  );
}

function Invitations({
  data,
  refreshDashboard,
  api,
}: {
  data: DashboardData;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const ownedAgentIds = useMemo(
    () => new Set(data.agents.map((agent) => String(agent.agentId))),
    [data.agents],
  );
  const currentProposal = (interaction: Record<string, any>) =>
    [...(interaction.contractRevisions ?? [])]
      .reverse()
      .find((revision) => revision.status === 'proposed');
  const respondingAgent = (interaction: Record<string, any>) => {
    const proposal = currentProposal(interaction);
    return (interaction.contract?.parties ?? []).find(
      (agentId: string) => ownedAgentIds.has(String(agentId)) && !proposal?.acceptances?.[agentId],
    );
  };
  const incoming = data.federatedInteractions.filter(
    (interaction) => currentProposal(interaction) && respondingAgent(interaction),
  );
  const respond = async (
    interactionId: string,
    revisionId: string,
    agentId: string,
    decision: 'accept' | 'reject',
  ) => {
    setWorking(interactionId);
    setError('');
    try {
      await api(
        `/v0.1/federated-interactions/${encodeURIComponent(interactionId)}/contract-proposals/${encodeURIComponent(revisionId)}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ agentId, decision }),
        },
      );
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not respond to invitation');
    } finally {
      setWorking('');
    }
  };
  if (!incoming.length && !data.federatedInteractions.length) return null;
  return (
    <Panel
      title={incoming.length ? `Contract decisions (${incoming.length})` : 'Shared interactions'}
      subtitle=""
    >
      {error ? (
        <div className="errorBar" role="alert">
          {error}
        </div>
      ) : null}
      {(incoming.length ? incoming : data.federatedInteractions.slice(0, 5)).map((interaction) => (
        <article className="setupRequest" key={interaction.interactionId}>
          <div>
            <strong>{interaction.contract?.purpose ?? interaction.interactionId}</strong>
            <small>
              {interaction.initiatorAgentId} → {interaction.responderAgentId} · {interaction.status}
            </small>
            <small>
              Contract v{interaction.contractRevision ?? 1}:{' '}
              {String(currentProposal(interaction)?.termsHash ?? interaction.termsHash).slice(
                0,
                16,
              )}
              …
              {currentProposal(interaction)
                ? ` · proposed by ${currentProposal(interaction).proposedByAgentId}`
                : ' · agreed'}
            </small>
            {interaction.contractRevisions?.length > 1 ? (
              <small>{interaction.contractRevisions.length} recorded contract revisions</small>
            ) : null}
            {data.liveSessions.find(
              (session) => session.interactionId === interaction.interactionId,
            ) ? (
              <small className="autoAccepted">
                Live session:{' '}
                {
                  data.liveSessions.find(
                    (session) => session.interactionId === interaction.interactionId,
                  )?.status
                }
              </small>
            ) : null}
            {interaction.status === 'active' &&
            interaction.acceptances?.[interaction.responderAgentId]?.method ===
              'policy_auto_accept' ? (
              <small className="autoAccepted">✓ Auto-approved by the responder's safe policy</small>
            ) : null}
          </div>
          {currentProposal(interaction) && respondingAgent(interaction) ? (
            <div className="decisionButtons">
              <button
                className="secondary"
                type="button"
                disabled={working === interaction.interactionId}
                onClick={() =>
                  void respond(
                    interaction.interactionId,
                    currentProposal(interaction).revisionId,
                    respondingAgent(interaction),
                    'reject',
                  )
                }
              >
                Reject
              </button>
              <button
                className="primary"
                type="button"
                disabled={working === interaction.interactionId}
                onClick={() =>
                  void respond(
                    interaction.interactionId,
                    currentProposal(interaction).revisionId,
                    respondingAgent(interaction),
                    'accept',
                  )
                }
              >
                {working === interaction.interactionId
                  ? 'Working…'
                  : interaction.status === 'active'
                    ? 'Accept amendment'
                    : 'Accept contract'}
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </Panel>
  );
}

function Insights({ data }: { data: DashboardData }) {
  const eligible = data.learningEligibility.filter((item) => item.eligible);
  const pendingFeedback = data.feedbackRequests.filter((item) => item.status === 'pending');
  const provisional = data.interactionConclusions.filter(
    (item) => item.lifecycle === 'provisional',
  );
  return (
    <>
      <PageHead page="insights" />
      <section className="insightPrinciple">
        <div>
          <p className="pageKicker">
            <span>//</span> how to read this
          </p>
          <h2>Reliability is contextual, not a leaderboard.</h2>
          <p>
            Every profile is tied to an agent version and task category. Scores reflect eligible
            structured outcomes and decay as history gets older.
          </p>
        </div>
        <div className="insightStats">
          <span>
            <strong>{data.profiles.length}</strong> contextual profiles
          </span>
          <span>
            <strong>{eligible.length}</strong> eligible interactions
          </span>
          <span>
            <strong>{pendingFeedback.length}</strong> feedback pending
          </span>
          <span>
            <strong>{provisional.length}</strong> provisional signals
          </span>
        </div>
      </section>
      {!!provisional.length && (
        <Panel
          title="Provisional interaction signals"
          subtitle="Available now, kept separate from corroborated reliability history"
        >
          <div className="learningDecisionList">
            {provisional
              .slice()
              .sort((left, right) => Date.parse(timestamp(right)) - Date.parse(timestamp(left)))
              .map((conclusion) => (
                <article key={conclusion.conclusionId}>
                  <StatusPill value="provisional" />
                  <div>
                    <strong>{conclusion.summary}</strong>
                    <small>
                      {Math.round(Number(conclusion.confidence ?? 0) * 100)}% confidence · peer{' '}
                      {humanize(conclusion.peerReportStatus ?? 'awaiting').toLowerCase()} ·{' '}
                      {relativeTime(timestamp(conclusion))}
                    </small>
                    <p>
                      Missing report from{' '}
                      {(conclusion.missingReportAgentIds ?? []).join(', ') || 'the counterparty'}.
                      The signal will be revised if more structured evidence arrives.
                    </p>
                  </div>
                </article>
              ))}
          </div>
        </Panel>
      )}
      <section className="insightGrid">
        {data.profiles.length ? (
          data.profiles.map((profile) => {
            const deltas = data.profileDeltas
              .filter(
                (delta) =>
                  delta.agentId === profile.agentId &&
                  delta.agentVersion === profile.agentVersion &&
                  delta.taskCategory === profile.taskCategory,
              )
              .sort((left, right) => Date.parse(timestamp(right)) - Date.parse(timestamp(left)));
            return (
              <Panel
                key={`${profile.agentId}-${profile.agentVersion}-${profile.taskCategory}`}
                title={profile.agentId}
                subtitle={`${humanize(profile.taskCategory)} · version ${profile.agentVersion}`}
              >
                <Profile profile={profile} expanded deltas={deltas} showHeader={false} />
              </Panel>
            );
          })
        ) : (
          <Empty
            title="Not enough verified evidence"
            text="Insights grow only from signed outcomes, eligible feedback, corrections, disputes, and version-aware history."
          />
        )}
      </section>
      {!!data.learningEligibility.length && (
        <Panel
          title="Recent learning decisions"
          subtitle="Why an interaction did or did not affect contextual history"
        >
          <div className="learningDecisionList">
            {data.learningEligibility
              .slice()
              .sort((left, right) => Date.parse(timestamp(right)) - Date.parse(timestamp(left)))
              .slice(0, 8)
              .map((decision) => (
                <article key={decision.decisionId}>
                  <StatusPill value={decision.eligible ? 'eligible' : 'excluded'} />
                  <div>
                    <strong>{decision.interactionId}</strong>
                    <small>
                      {Math.round(Number(decision.sampleWeight ?? 0) * 100)}% weight ·{' '}
                      {humanize(decision.contributionMode)} · {relativeTime(timestamp(decision))}
                    </small>
                    <p>{decision.reasons?.[0] ?? 'No reason supplied.'}</p>
                  </div>
                </article>
              ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function Connect({
  data,
  navigate,
  refreshDashboard,
  api,
}: {
  data: DashboardData;
  navigate: (page: Page) => void;
  refreshDashboard: () => Promise<void>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const endpoint = `${new URL(__OPENCLASP_PUBLIC_URL__).origin}/mcp`;
  const [connectionType, setConnectionType] = useState<'interactive' | 'hosted'>('hosted');
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [working, setWorking] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [providerForm, setProviderForm] = useState({
    provider: 'botpress' as 'botpress' | 'custom',
    agentName: '',
    projectName: '',
    description: '',
    capabilities: '',
    limitations: '',
    expiresInDays: 365,
  });
  const [providerResult, setProviderResult] = useState<{
    provider: 'botpress' | 'custom';
    agent: { agentId: string; name: string; framework: string };
    accessToken: { token: string; expiresAt: string };
  }>();
  const pending = data.setupRequests.filter((request) => request.status === 'pending');
  useEffect(() => {
    const poll = () => void refreshDashboard().catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => window.clearInterval(timer);
  }, [refreshDashboard]);
  const decide = async (requestId: string, decision: 'approve' | 'reject') => {
    setWorking(requestId);
    setDecisionError('');
    try {
      await api(`/v0.1/onboarding/${encodeURIComponent(requestId)}/${decision}`, {
        method: 'POST',
      });
      await refreshDashboard();
    } catch (reason) {
      setDecisionError(reason instanceof Error ? reason.message : 'Could not update setup request');
    } finally {
      setWorking('');
    }
  };
  const connectHostedProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking('hosted-provider');
    setProviderError('');
    try {
      const list = (value: string) =>
        value
          .split(/[,\n]/)
          .map((item) => item.trim())
          .filter(Boolean);
      const created = (await api('/v0.1/provider-connections', {
        method: 'POST',
        body: JSON.stringify({
          provider: providerForm.provider,
          agentName: providerForm.agentName,
          projectName: providerForm.projectName,
          description: providerForm.description,
          capabilities: list(providerForm.capabilities),
          limitations: list(providerForm.limitations),
          expiresInDays: providerForm.expiresInDays,
        }),
      })) as {
        provider: 'botpress' | 'custom';
        agent: { agentId: string; name: string; framework: string };
        accessToken: { token: string; expiresAt: string };
      };
      setProviderResult(created);
      await refreshDashboard().catch(() => undefined);
    } catch (reason) {
      setProviderError(reason instanceof Error ? reason.message : 'Could not create connection');
    } finally {
      setWorking('');
    }
  };
  return (
    <>
      <PageHead page="connect" />
      {pending.length > 0 && (
        <section className="setupRequests">
          <div>
            <p className="pageKicker">
              <span>//</span> confirmation required
            </p>
            <h2>Approve agent setup</h2>
            <p>
              An agent proposed this identity. Confirm it before OpenClasp binds the installation.
            </p>
          </div>
          {pending.map((request) => (
            <article className="setupRequest" key={request.requestId}>
              <div>
                <strong>{request.agentName ?? 'Switch installation'}</strong>
                <small>
                  {request.projectName ?? request.existingAgentId} · {request.framework}
                </small>
                {!!request.capabilities?.length && (
                  <div className="tags">
                    {request.capabilities.slice(0, 5).map((capability: string) => (
                      <span key={capability}>{capability}</span>
                    ))}
                  </div>
                )}
                {!!request.limitations?.length && (
                  <small>Limitations: {request.limitations.join(' · ')}</small>
                )}
                <div className="automationPreview">
                  <span>{request.autoPublish ? 'Public after approval' : 'Private'}</span>
                  <span>
                    {(request.agentMode ?? 'temporary_chat') === 'temporary_chat'
                      ? 'Hosted temporary A2A · encrypted history'
                      : 'Persistent runtime · direct A2A'}
                  </span>
                  <span>
                    {request.autoAcceptPolicy === 'safe_matching'
                      ? 'Auto-accept safe matches'
                      : 'Review every request'}
                  </span>
                </div>
              </div>
              <div className="decisionButtons">
                <button
                  className="secondary"
                  type="button"
                  disabled={working === request.requestId}
                  onClick={() => void decide(request.requestId, 'reject')}
                >
                  Reject
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={working === request.requestId}
                  onClick={() => void decide(request.requestId, 'approve')}
                >
                  {working === request.requestId ? 'Working…' : 'Approve & automate'}
                </button>
              </div>
            </article>
          ))}
          {decisionError && (
            <div className="loginError" role="alert">
              {decisionError}
            </div>
          )}
        </section>
      )}
      <div className="connectionTypePicker" role="tablist" aria-label="Agent connection type">
        <button
          type="button"
          role="tab"
          aria-selected={connectionType === 'hosted'}
          className={connectionType === 'hosted' ? 'active' : ''}
          onClick={() => setConnectionType('hosted')}
        >
          Hosted provider
          <small>Botpress and similar platforms</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={connectionType === 'interactive'}
          className={connectionType === 'interactive' ? 'active' : ''}
          onClick={() => setConnectionType('interactive')}
        >
          Interactive agent
          <small>Codex, Cursor, and OAuth clients</small>
        </button>
      </div>
      {connectionType === 'hosted' ? (
        <section className="connectLayout providerConnectLayout">
          <Panel title="Add a hosted agent" subtitle="Creates an isolated identity and credential">
            {providerResult ? (
              <div className="providerResult">
                <div className="successBanner">
                  <strong>{providerResult.agent.name} created</strong>
                  <span>{providerResult.agent.agentId}</span>
                </div>
                <label>
                  <span>MCP URL</span>
                  <code>{endpoint}</code>
                </label>
                <label>
                  <span>Agent token — copy it now; it will not be shown again</span>
                  <code>{providerResult.accessToken.token}</code>
                </label>
                <small>
                  This agent-bound token authorizes MCP and automatic runtime registration. It
                  cannot connect or manage another agent.
                </small>
                <div className="agentActions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(providerResult.accessToken.token);
                      setTokenCopied(true);
                      window.setTimeout(() => setTokenCopied(false), 2000);
                    }}
                  >
                    {tokenCopied ? 'Copied' : 'Copy token'}
                  </button>
                  <button className="primary" type="button" onClick={() => navigate('agents')}>
                    View agent
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="providerForm"
                onSubmit={(event) => void connectHostedProvider(event)}
              >
                <label>
                  <span>Provider</span>
                  <select
                    value={providerForm.provider}
                    onChange={(event) =>
                      setProviderForm((value) => ({
                        ...value,
                        provider: event.target.value as 'botpress' | 'custom',
                      }))
                    }
                  >
                    <option value="botpress">Botpress</option>
                    <option value="custom">Custom / self-hosted</option>
                  </select>
                </label>
                <label>
                  <span>Agent name</span>
                  <input
                    required
                    maxLength={100}
                    value={providerForm.agentName}
                    onChange={(event) =>
                      setProviderForm((value) => ({ ...value, agentName: event.target.value }))
                    }
                    placeholder="Recruiting agent"
                  />
                </label>
                <label>
                  <span>Project</span>
                  <input
                    required
                    maxLength={100}
                    value={providerForm.projectName}
                    onChange={(event) =>
                      setProviderForm((value) => ({ ...value, projectName: event.target.value }))
                    }
                    placeholder="Recruiting"
                  />
                </label>
                <label className="fullWidth">
                  <span>Purpose</span>
                  <textarea
                    required
                    maxLength={500}
                    value={providerForm.description}
                    onChange={(event) =>
                      setProviderForm((value) => ({ ...value, description: event.target.value }))
                    }
                    placeholder="Matches suitable candidates with open roles"
                  />
                </label>
                <label>
                  <span>Capabilities, comma-separated</span>
                  <input
                    required
                    value={providerForm.capabilities}
                    onChange={(event) =>
                      setProviderForm((value) => ({ ...value, capabilities: event.target.value }))
                    }
                    placeholder="candidate matching, interview coordination"
                  />
                </label>
                <label>
                  <span>Limitations, comma-separated</span>
                  <input
                    value={providerForm.limitations}
                    onChange={(event) =>
                      setProviderForm((value) => ({ ...value, limitations: event.target.value }))
                    }
                    placeholder="no final hiring decisions"
                  />
                </label>
                <label>
                  <span>Credential expiry</span>
                  <select
                    value={providerForm.expiresInDays}
                    onChange={(event) =>
                      setProviderForm((value) => ({
                        ...value,
                        expiresInDays: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </label>
                <div className="providerSubmit fullWidth">
                  <p>This does not reuse or modify your Codex agent.</p>
                  <button
                    className="primary"
                    type="submit"
                    disabled={working === 'hosted-provider'}
                  >
                    {working === 'hosted-provider' ? 'Creating…' : 'Create agent credentials'}
                  </button>
                </div>
                {providerError ? (
                  <div className="loginError fullWidth" role="alert">
                    {providerError}
                  </div>
                ) : null}
              </form>
            )}
          </Panel>
          <Panel
            title={
              providerForm.provider === 'botpress' ? 'Configure Botpress' : 'Deploy the sidecar'
            }
            subtitle={
              providerForm.provider === 'botpress'
                ? 'MCP and inbound runtime are separate connections'
                : 'Runs beside an agent on any cloud'
            }
          >
            {providerForm.provider === 'botpress' ? (
              <>
                <div className="connectSteps">
                  <div className="connectStep">
                    <b>1</b>
                    <span>Add the displayed MCP URL with Bearer authentication.</span>
                  </div>
                  <div className="connectStep">
                    <b>2</b>
                    <span>
                      Paste the generated <code>oc_at_…</code> agent token.
                    </span>
                  </div>
                  <div className="connectStep">
                    <b>3</b>
                    <span>Install the OpenClasp Botpress runtime integration for inbound A2A.</span>
                  </div>
                </div>
                <div className="notice providerNotice">
                  MCP proves outbound tool access only. Autonomous runtime becomes connected only
                  after the Botpress integration registers its webhook successfully.
                </div>
              </>
            ) : (
              <>
                <div className="connectSteps">
                  <div className="connectStep">
                    <b>1</b>
                    <span>
                      Deploy <code>Dockerfile.sidecar</code> beside the agent.
                    </span>
                  </div>
                  <div className="connectStep">
                    <b>2</b>
                    <span>
                      Set <code>OPENCLASP_AGENT_TOKEN</code>, <code>OPENCLASP_RUNTIME_URL</code>,
                      and <code>AGENT_ADAPTER_URL</code>.
                    </span>
                  </div>
                  <div className="connectStep">
                    <b>3</b>
                    <span>
                      The sidecar verifies and registers itself; no endpoint paste is needed.
                    </span>
                  </div>
                </div>
                <div className="notice providerNotice">
                  The application implements three internal POST hooks: session-offer,
                  session-activated, and message. Agent-to-agent content remains off OpenClasp.
                </div>
              </>
            )}
          </Panel>
        </section>
      ) : (
        <section className="connectLayout">
          <Panel title="Connect with OAuth" subtitle="For interactive MCP clients">
            <div className="endpoint">
              <code>{endpoint}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(endpoint);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="connectSteps">
              <div className="connectStep">
                <b>1</b>
                <span>Add this MCP URL and complete OAuth.</span>
              </div>
              <div className="connectStep">
                <b>2</b>
                <span>
                  Tell the agent: <code>Set yourself up on OpenClasp</code>.
                </span>
              </div>
              <div className="connectStep">
                <b>3</b>
                <span>Approve the proposed identity and mode here.</span>
              </div>
            </div>
          </Panel>
          <Panel title="Interactive clients" subtitle="Best for temporary user-driven sessions">
            <ul className="checkList">
              <li>OAuth opens in the browser</li>
              <li>Each installation is explicitly approved</li>
              <li>Temporary chats receive hosted A2A history</li>
              <li>Persistent runtimes can switch to direct A2A</li>
            </ul>
          </Panel>
        </section>
      )}
    </>
  );
}

function SettingsPage({
  settings,
  setSettings,
  api,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const updated = (await api('/v0.1/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      })) as Settings;
      setSettings(updated);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  }, [api, settings, setSettings]);
  return (
    <>
      <PageHead page="settings" />
      <section className="settingsCard">
        <Setting label="Display name" description="Shown only inside your OpenClasp account.">
          <input
            value={settings.displayName}
            onChange={(event) =>
              setSettings((value) => ({ ...value, displayName: event.target.value }))
            }
            placeholder="Team or operator name"
          />
        </Setting>
        <Setting
          label="Network contribution"
          description="Allow eligible structured aggregates to improve contextual intelligence. Raw conversations are never included."
        >
          <Toggle
            checked={settings.contributionEnabled}
            label="Network contribution"
            onChange={(checked) =>
              setSettings((value) => ({ ...value, contributionEnabled: checked }))
            }
          />
        </Setting>
        <Setting
          label="Evidence sharing"
          description="Controls when permitted evidence references may be shared with interaction participants."
        >
          <select
            value={settings.evidenceSharing}
            onChange={(event) =>
              setSettings((value) => ({
                ...value,
                evidenceSharing: event.target.value as Settings['evidenceSharing'],
              }))
            }
          >
            <option value="never">Never</option>
            <option value="ask">Ask every time</option>
            <option value="contract_only">When contract permits</option>
          </select>
        </Setting>
        <Setting
          label="Structured record retention"
          description="Retention for hosted account records. Signed protocol records may require separate revocation markers."
        >
          <select
            value={settings.retentionDays}
            onChange={(event) =>
              setSettings((value) => ({ ...value, retentionDays: Number(event.target.value) }))
            }
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={0}>No automatic deletion</option>
          </select>
        </Setting>
        <Setting
          label="Raw agent messages"
          description="Persistent runtimes remain direct and are not stored. Temporary chat messages pass through OpenClasp and are encrypted at rest for 30 days."
        >
          <span className="locked">MODE DEPENDENT</span>
        </Setting>
        <div className="saveRow">
          <button className="primary" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && <span role="status">Saved</span>}
          {error && (
            <span className="loginError" role="alert">
              {error}
            </span>
          )}
        </div>
      </section>
    </>
  );
}

function PageHead({
  page,
  action,
  onAction,
}: {
  page: Page;
  action?: string;
  onAction?: () => void;
}) {
  const meta = pageMeta[page];
  return (
    <header className="pageHead">
      <div>
        <p className="pageKicker">
          <span>//</span> {meta.eyebrow.toLowerCase()}
        </p>
        <h1>{meta.title}</h1>
        <p className="lede">{meta.lede}</p>
      </div>
      {action && (
        <button className="primary" type="button" onClick={onAction}>
          {action.toLowerCase()} <span aria-hidden="true">→</span>
        </button>
      )}
    </header>
  );
}
function Metric({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: number;
  note: string;
  warn?: boolean;
}) {
  return (
    <article className={warn ? 'metric warn' : 'metric'} title={note}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Panel({
  title,
  subtitle,
  children,
}: React.PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <section className="panel">
      <div className="panelHead">
        <h2 className="panelKicker">
          <span>//</span> {title.toLowerCase()}
        </h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
function Timeline({ events }: { events: Record<string, any>[] }) {
  return events.length ? (
    <div className="timeline">
      {events.map((event) => (
        <HistoryRow key={event.eventId} item={{ ...event, _kind: 'event' }} />
      ))}
    </div>
  ) : (
    <Empty
      title="Nothing recorded yet"
      text="Activity appears after your connected agents submit signed structured events."
    />
  );
}
function HistoryRow({ item }: { item: Record<string, any> }) {
  const kind = String(item.eventType ?? item._kind ?? 'record').replaceAll('_', ' ');
  const id = String(item.agentId ?? item.interactionId ?? item.receiptId ?? 'OpenClasp');
  return (
    <article className="historyRow">
      <span className={`eventDot ${item.eventType ?? item._kind}`} />
      <div>
        <strong>{kind}</strong>
        <small>
          {id} · {new Date(timestamp(item)).toLocaleString()}
        </small>
      </div>
      <b>{item.visibility ?? item.outcome ?? item.status ?? 'SIGNED'}</b>
    </article>
  );
}
function AgentCard({
  agent,
  projectName,
  published,
  working,
  onSave,
  runtime,
  runtimeWorking,
  deleteWorking,
  onRuntime,
  onDisableRuntime,
  accessTokens,
  accessTokenWorking,
  onRevokeAccessToken,
  onDelete,
}: {
  agent: Record<string, any>;
  projectName?: string;
  published: boolean;
  working: boolean;
  onSave: (value: {
    autoPublish: boolean;
    autoAcceptPolicy: 'off' | 'safe_matching';
    autoAcceptTaskCategories: string[];
  }) => Promise<boolean>;
  runtime: Record<string, any> | undefined;
  runtimeWorking: boolean;
  deleteWorking: boolean;
  onRuntime: (endpoint: string) => void;
  onDisableRuntime: () => void;
  accessTokens: Record<string, any>[];
  accessTokenWorking: boolean;
  onRevokeAccessToken: (tokenId: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [autoPublish, setAutoPublish] = useState(Boolean(agent.autoPublish ?? published));
  const [autoAcceptPolicy, setAutoAcceptPolicy] = useState<'off' | 'safe_matching'>(
    agent.autoAcceptPolicy === 'safe_matching' ? 'safe_matching' : 'off',
  );
  const [categories, setCategories] = useState<string>(
    (agent.autoAcceptTaskCategories?.length
      ? agent.autoAcceptTaskCategories
      : (agent.capabilities ?? [])
    ).join(', '),
  );
  const [runtimeEndpoint, setRuntimeEndpoint] = useState(String(runtime?.endpoint ?? ''));
  const mode = agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat');
  const temporary = mode === 'temporary_chat';
  const ready = published && (temporary || runtime?.status === 'verified');
  const online = agent.presence?.status === 'online';
  const providerConnected = accessTokens.length > 0;
  const endpoint = String(
    temporary
      ? `/a2a/temporary/${encodeURIComponent(agent.agentId)}`
      : (runtime?.a2aEndpoint ?? agent.a2aEndpoint ?? 'Connect a runtime first'),
  );
  const identityLabel = agent.revoked
    ? 'REVOKED'
    : agent.identityMode === 'owner_managed'
      ? 'OWNER VERIFIED'
      : agent.identityMode === 'oauth_installation'
        ? 'AUTHENTICATED'
        : 'VERIFIED';
  return (
    <article className="agentCard">
      <div className="agentTop">
        <span className="agentGlyph">
          <Bot />
        </span>
        <div className="agentBadges">
          <b className={online && temporary ? 'onlineBadge' : 'offlineBadge'}>
            {temporary
              ? online
                ? 'CHAT ACTIVE'
                : 'CHAT IDLE'
              : runtime?.status === 'verified'
                ? 'ENDPOINT VERIFIED'
                : providerConnected
                  ? 'TOKEN ONLY'
                  : 'ENDPOINT MISSING'}
          </b>
          <b className={agent.revoked ? 'bad' : ''}>{identityLabel}</b>
          <b className={ready ? 'readyBadge' : 'needsBadge'}>{ready ? 'READY' : 'SETUP NEEDED'}</b>
        </div>
      </div>
      <h2>{agent.name ?? agent.agentId}</h2>
      <p>{projectName ?? `Version ${agent.agentVersion ?? '1.0.0'}`}</p>
      <div className="tags">
        {(agent.capabilities ?? []).slice(0, 4).map((capability: string) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
      <small>
        {agent.framework ? `${agent.framework} · ` : ''}
        {agent.identityMode === 'owner_managed'
          ? 'Owner-created · '
          : agent.identityMode === 'oauth_installation'
            ? 'OAuth-bound · '
            : 'Ed25519 · '}
        Created {new Date(agent.createdAt).toLocaleDateString()}
      </small>
      <small>
        {agent.presence?.lastSeenAt
          ? `Last agent activity ${new Date(agent.presence.lastSeenAt).toLocaleString()}`
          : 'No agent activity recorded yet'}
      </small>
      {published ? (
        <div className="agentPublicLinks">
          <a href={`/a/${encodeURIComponent(agent.agentId)}`} target="_blank" rel="noreferrer">
            Verified public profile
          </a>
          <a
            href={`/agents/${encodeURIComponent(agent.agentId)}/a2a-agent-card.json`}
            target="_blank"
            rel="noreferrer"
          >
            A2A Agent Card
          </a>
        </div>
      ) : null}
      <div className="automationSummary">
        <span>{published ? 'Public discovery' : 'Private'}</span>
        <span>{temporary ? 'Hosted temporary A2A' : 'Direct agent-owned A2A'}</span>
        <span>
          {agent.autoAcceptPolicy === 'safe_matching' ? 'Safe tasks automatic' : 'Manual approval'}
        </span>
      </div>
      <div className="runtimeBox">
        <div>
          <strong>{temporary ? 'Temporary chat endpoint' : 'Autonomous runtime'}</strong>
          <span
            className={
              temporary || runtime?.status === 'verified' ? 'runtimeLive' : 'runtimeMissing'
            }
          >
            {temporary
              ? 'HOSTED BY OPENCLASP'
              : runtime?.status === 'verified'
                ? 'VERIFIED'
                : 'NOT CONNECTED'}
          </span>
        </div>
        <p>
          {temporary
            ? 'OpenClasp receives A2A for this temporary identity and encrypts its history at rest. Connect a runtime below to switch to direct A2A.'
            : runtime?.status === 'verified'
              ? 'The agent runtime registered itself successfully. Live message bodies travel directly between agents.'
              : providerConnected
                ? 'MCP is connected, but inbound A2A is not. Install the provider connector or deploy the sidecar; it registers this endpoint automatically.'
                : 'Install a provider connector, deploy the sidecar, or register a native A2A endpoint.'}
        </p>
        <input
          type="url"
          value={runtimeEndpoint}
          onChange={(event) => setRuntimeEndpoint(event.target.value)}
          placeholder="https://agent.example.com/openclasp"
        />
        <small>
          Manual registration is only for a runtime that already implements OpenClasp A2A.
        </small>
        <div className="agentActions">
          {runtime?.status === 'verified' ? (
            <button
              className="secondary"
              type="button"
              disabled={runtimeWorking}
              onClick={onDisableRuntime}
            >
              Disable runtime
            </button>
          ) : null}
          <button
            className="primary"
            type="button"
            disabled={runtimeWorking || !runtimeEndpoint.trim()}
            onClick={() => onRuntime(runtimeEndpoint.trim())}
          >
            {runtimeWorking ? 'Verifying…' : runtime ? 'Rotate connection' : 'Verify & connect'}
          </button>
        </div>
        {runtime?.lastError ? <small>Last session error: {runtime.lastError}</small> : null}
      </div>
      {accessTokens.length ? (
        <div className="accessTokenBox">
          <div className="accessTokenHead">
            <div>
              <strong>Provider connections</strong>
              <span>{accessTokens.length} ACTIVE</span>
            </div>
            <p>Created through Connect. Revoke a provider here if its credential is exposed.</p>
          </div>
          <div className="tokenList">
            {accessTokens.map((token) => (
              <div key={token.tokenId}>
                <span>
                  <strong>{token.name}</strong>
                  <small>
                    Created {new Date(token.createdAt).toLocaleDateString()} · expires{' '}
                    {new Date(token.expiresAt).toLocaleDateString()}
                    {token.lastUsedAt
                      ? ` · used ${new Date(token.lastUsedAt).toLocaleString()}`
                      : ' · never used'}
                  </small>
                </span>
                <button
                  className="secondary dangerButton"
                  type="button"
                  disabled={accessTokenWorking}
                  onClick={() => {
                    if (window.confirm(`Revoke “${String(token.name)}”? Botpress will disconnect.`))
                      void onRevokeAccessToken(String(token.tokenId));
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="automationForm">
          <label>
            <span>
              {temporary ? 'OpenClasp temporary A2A endpoint' : 'Agent-owned A2A endpoint'}
            </span>
            <input type="url" value={endpoint} readOnly />
          </label>
          <label>
            <span>Invitation policy</span>
            <select
              value={autoAcceptPolicy}
              onChange={(event) =>
                setAutoAcceptPolicy(event.target.value as 'off' | 'safe_matching')
              }
            >
              <option value="safe_matching">Auto-accept safe matches</option>
              <option value="off">Review every request</option>
            </select>
          </label>
          <label>
            <span>Safe task categories</span>
            <input
              value={categories}
              onChange={(event) => setCategories(event.target.value)}
              placeholder="research, planning, coding"
            />
          </label>
          <label className="checkControl">
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(event) => setAutoPublish(event.target.checked)}
            />
            <span>Publish and keep Agent Card updated</span>
          </label>
          <div className="agentActions">
            <button className="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="primary"
              type="button"
              disabled={working || agent.status === 'revoked'}
              onClick={() =>
                void onSave({
                  autoPublish,
                  autoAcceptPolicy,
                  autoAcceptTaskCategories: categories
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                }).then((ok) => {
                  if (ok) setEditing(false);
                })
              }
            >
              {working ? 'Saving…' : 'Save automation'}
            </button>
          </div>
        </div>
      ) : (
        <div className="agentActions agentManagementActions">
          <button
            className="secondary dangerButton"
            type="button"
            disabled={working || runtimeWorking || deleteWorking}
            onClick={onDelete}
          >
            {deleteWorking ? 'Deleting…' : 'Delete agent'}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={working || runtimeWorking || deleteWorking || agent.status === 'revoked'}
            onClick={() => setEditing(true)}
          >
            Configure automation
          </button>
        </div>
      )}
    </article>
  );
}
function Profile({
  profile,
  expanded,
  deltas = [],
  showHeader = true,
}: {
  profile: Record<string, any>;
  expanded?: boolean;
  deltas?: Record<string, any>[];
  showHeader?: boolean;
}) {
  const dimensions = [
    ['Completion', profile.completion],
    ['Acceptance', profile.acceptance],
    ['Specification', profile.specification],
    ['Scope', profile.scope],
    ['Evidence', profile.evidence],
    ...(expanded
      ? [
          ['Communication', profile.communication],
          ['Deadline', profile.deadline],
          ['Dispute-free', 1 - Number(profile.disputes ?? 0)],
        ]
      : []),
  ] as [string, number][];
  const latestDelta = deltas[0];
  return (
    <article className="profile">
      <div className={showHeader ? 'profileHead' : 'profileHead profileHeadCompact'}>
        {showHeader ? (
          <div>
            <strong>{profile.agentId}</strong>
            <small>
              {humanize(profile.taskCategory)} · version {profile.agentVersion ?? 'unknown'}
            </small>
          </div>
        ) : (
          <small>
            Effective evidence{' '}
            {Number(profile.effectiveSampleSize ?? profile.sampleSize ?? 0).toFixed(1)}
            {profile.updatedAt ? ` · updated ${relativeTime(profile.updatedAt)}` : ''}
          </small>
        )}
        <span className="sampleBadge">
          {profile.sampleSize ?? 0} outcome{Number(profile.sampleSize) === 1 ? '' : 's'}
        </span>
      </div>
      {showHeader ? (
        <div className="profileEvidenceLine">
          <small>
            Effective evidence{' '}
            {Number(profile.effectiveSampleSize ?? profile.sampleSize ?? 0).toFixed(1)}
            {profile.updatedAt ? ` · updated ${relativeTime(profile.updatedAt)}` : ''}
          </small>
        </div>
      ) : null}
      {dimensions.map(([label, value]) => (
        <Meter key={label} label={label} value={Number(value ?? 0.5)} />
      ))}
      {latestDelta ? (
        <div className="profileDelta">
          <span>Latest evidence impact</span>
          <div>
            {Object.entries(latestDelta.dimensionDeltas ?? {})
              .filter(([, value]) => Math.abs(Number(value)) >= 0.001)
              .slice(0, 5)
              .map(([dimension, value]) => (
                <b className={Number(value) >= 0 ? 'positive' : 'negative'} key={dimension}>
                  {humanize(dimension)} {Number(value) >= 0 ? '+' : ''}
                  {(Number(value) * 100).toFixed(1)}
                </b>
              ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
function Meter({ label, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(1, value));
  return (
    <div className="meter">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.round(bounded * 100)}%` }} />
      </i>
      <strong>{Math.round(bounded * 100)}%</strong>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty">
      <Bot />
      <strong>{title}</strong>
      <p>{text}</p>
      {action && (
        <button className="secondary" type="button" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
function TextButton({ children, onClick }: React.PropsWithChildren<{ onClick: () => void }>) {
  return (
    <button className="textButton" type="button" onClick={onClick}>
      {children}
    </button>
  );
}
function Setting({
  label,
  description,
  children,
}: React.PropsWithChildren<{ label: string; description: string }>) {
  return (
    <div className="setting">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      className={checked ? 'toggle on' : 'toggle'}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Loading({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? 'loading compact' : 'loading'}>
      <span className="spinner" aria-hidden="true" />
      <p>Verifying session…</p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.6 12.2c0-.8-.1-1.6-.2-2.3H12v4.4h5.9c-.3 1.4-1 2.6-2.2 3.4v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.3"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.7 1.1-2.8 0-5.2-1.9-6.1-4.4H2.2v2.9C4 20.5 7.7 23 12 23"
      />
      <path
        fill="#FBBC05"
        d="M5.9 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V7H2.2C1.4 8.6 1 10.3 1 12s.4 3.4 1.2 5z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.6 0 3.1.6 4.2 1.7l3.2-3.2C17.5 1.5 15 0.5 12 .5 7.7.5 4 3 2.2 7l3.7 2.9C6.8 6.7 9.2 4.8 12 4.8"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.6s.8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1a3.6 3.6 0 0 1 .1 2.6 3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2"
      />
    </svg>
  );
}

function humanize(value: unknown) {
  const text = String(value ?? '')
    .replaceAll('_', ' ')
    .trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'Unknown';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

function relativeTime(value: string) {
  const milliseconds = Date.now() - Date.parse(value);
  if (!Number.isFinite(milliseconds)) return 'Time unavailable';
  const minutes = Math.round(Math.abs(milliseconds) / 60_000);
  const future = milliseconds < 0;
  const phrase =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1_440
          ? `${Math.round(minutes / 60)}h`
          : `${Math.round(minutes / 1_440)}d`;
  return minutes < 1 ? phrase : future ? `in ${phrase}` : `${phrase} ago`;
}

function feedbackState(requests: Record<string, any>[]) {
  if (!requests.length) return 'Starts after a completion report';
  const pending = requests.filter((request) => request.status === 'pending').length;
  if (pending) return `${pending} response${pending === 1 ? '' : 's'} still pending`;
  const expired = requests.filter((request) => request.status === 'expired').length;
  return expired
    ? `${expired} request${expired === 1 ? '' : 's'} timed out`
    : 'Bilateral feedback closed';
}

function StatusPill({ value }: { value: string }) {
  const normalized = String(value).toLowerCase();
  const tone = [
    'success',
    'active',
    'ready',
    'met',
    'eligible',
    'attested',
    'allow',
    'completed',
  ].includes(normalized)
    ? 'good'
    : ['failure', 'denied', 'deny', 'missed', 'rejected', 'violation'].some((item) =>
          normalized.includes(item),
        )
      ? 'danger'
      : ['partial', 'pending', 'provisional', 'challenge', 'conflict', 'expired', 'excluded'].some(
            (item) => normalized.includes(item),
          )
        ? 'warn'
        : 'neutral';
  return (
    <span className={`statusPill ${tone}`}>
      <i />
      {humanize(value)}
    </span>
  );
}

function timestamp(item: Record<string, any>) {
  return String(
    item.timestamp ??
      item.generatedAt ??
      item.decidedAt ??
      item.appliedAt ??
      item.submittedAt ??
      item.completedAt ??
      item.activatedAt ??
      item.updatedAt ??
      item.requestedAt ??
      item.createdAt ??
      new Date(0).toISOString(),
  );
}

if (!__AUTH0_DOMAIN__ || !__AUTH0_CLIENT_ID__ || !__AUTH0_AUDIENCE__)
  throw new Error('Auth0 public configuration is incomplete');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname === '/sso-callback' ? <AuthCallback /> : <App />}
  </React.StrictMode>,
);
