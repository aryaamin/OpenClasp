import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
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

type Auth0User = { sub: string; name?: string; email?: string; picture?: string };
type AuthSession = { user: Auth0User };
type AuthTransaction = { state: string; nonce: string; verifier: string };
type Theme = 'dark' | 'light';

const authTransactionKey = 'openclasp.auth0.transaction';
const themeKey = 'openclasp.theme.v1';

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
const pages = [
  'dashboard',
  'conversations',
  'history',
  'agents',
  'insights',
  'connect',
  'settings',
] as const;
type Page = (typeof pages)[number];
const pageMeta: Record<Page, { label: string; title: string; lede: string; eyebrow: string }> = {
  dashboard: {
    label: 'Overview',
    title: 'Overview',
    lede: 'Agent readiness, signed outcomes, and anything waiting on you.',
    eyebrow: 'Network',
  },
  history: {
    label: 'History',
    title: 'History',
    lede: 'Structured events, receipts, and shared contracts — never raw messages.',
    eyebrow: 'Audit',
  },
  conversations: {
    label: 'Conversations',
    title: 'Temporary conversations',
    lede: 'Hosted history for temporary chat identities. Direct runtime messages never appear here.',
    eyebrow: 'Inbox',
  },
  agents: {
    label: 'Agents',
    title: 'Agents',
    lede: 'Identities, runtimes, and the automation each agent is allowed to do.',
    eyebrow: 'Registry',
  },
  insights: {
    label: 'Insights',
    title: 'Insights',
    lede: 'Task-specific reliability from signed outcomes. No universal score.',
    eyebrow: 'Context',
  },
  connect: {
    label: 'Connect',
    title: 'Connect',
    lede: 'Add an agent once. Approve its identity, then OpenClasp handles the routine work.',
    eyebrow: 'Setup',
  },
  settings: {
    label: 'Settings',
    title: 'Settings',
    lede: 'Privacy, retention, and what this account may contribute to the network.',
    eyebrow: 'Account',
  },
};

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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const transaction: AuthTransaction = { state: randomValue(), nonce: randomValue(), verifier };
  sessionStorage.setItem(authTransactionKey, JSON.stringify(transaction));
  const parameters = new URLSearchParams({
    client_id: __AUTH0_CLIENT_ID__,
    redirect_uri: `${new URL(__AUTH0_AUDIENCE__).origin}/sso-callback`,
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
    returnTo: `${new URL(__AUTH0_AUDIENCE__).origin}/login`,
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
    if (!response.ok)
      throw new Error((await response.text()) || `Request failed: ${response.status}`);
    return response.json();
  });
}

function route(): Page {
  const value = location.pathname.slice(1) || 'dashboard';
  return pages.includes(value as Page) ? (value as Page) : 'dashboard';
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
      ? `${pageMeta[page].label} · OpenClasp`
      : session === null
        ? 'Sign in · OpenClasp'
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
    localStorage.setItem(themeKey, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6f1' : '#0b0d0b');
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setPage(route());
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session && location.pathname !== '/login') history.replaceState({}, '', '/login');
    if (!session) return;
    if (location.pathname === '/login') history.replaceState({}, '', '/dashboard');
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
      <Login
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
      <Login />
    );

  return (
    <div className="appShell">
      <a className="skipLink" href="#main">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          <div className="mark">OC</div>
          <div>
            <strong>OpenClasp</strong>
            <small>ASSURANCE NETWORK</small>
          </div>
        </div>
        <nav aria-label="Dashboard">
          <Nav
            page="dashboard"
            active={page}
            onClick={navigate}
            label="Overview"
            icon="home"
            badge={pendingInvites || pendingSetup ? pendingInvites + pendingSetup : 0}
          />
          <Nav page="history" active={page} onClick={navigate} label="History" icon="history" />
          <Nav
            page="conversations"
            active={page}
            onClick={navigate}
            label="Conversations"
            icon="connect"
            badge={unreadThreads}
          />
          <Nav page="agents" active={page} onClick={navigate} label="Agents" icon="agents" />
          <Nav page="insights" active={page} onClick={navigate} label="Insights" icon="insights" />
          <Nav
            page="connect"
            active={page}
            onClick={navigate}
            label="Connect"
            icon="connect"
            badge={pendingSetup}
          />
          <Nav page="settings" active={page} onClick={navigate} label="Settings" icon="settings" />
        </nav>
        <button
          className="themeSwitch"
          type="button"
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
        <div className="privacyStamp">
          <span className="liveDot" />
          <div>
            <strong>Privacy separated</strong>
            <small>Direct messages never stored</small>
          </div>
        </div>
        <button
          className="account"
          type="button"
          onClick={() => void signOut(preview)}
          title="Sign out"
        >
          <span>{initials(session.user.name || session.user.email || 'OC')}</span>
          <div>
            <strong>{session.user.name || 'OpenClasp user'}</strong>
            <small>{session.user.email || 'Signed in'}</small>
          </div>
          <b>Sign out</b>
        </button>
      </aside>
      <div>
        <div className="mobileBar">
          <div className="brand">
            <div className="mark">OC</div>
            <div>
              <strong>OpenClasp</strong>
              <small>ASSURANCE</small>
            </div>
          </div>
          <div className="mobileActions">
            <button
              className="iconButton"
              type="button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button
              className="iconButton"
              type="button"
              aria-label="Sign out"
              onClick={() => void signOut(preview)}
            >
              <span>{initials(session.user.name || session.user.email || 'OC')}</span>
            </button>
          </div>
        </div>
        <main id="main">
          {preview && (
            <div className="previewBanner">Local preview with sample data. Changes stay here.</div>
          )}
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
        </main>
      </div>
    </div>
  );
}

function Login({ onPreview }: { onPreview?: () => void }) {
  const [error, setError] = useState('');
  const continueWith = async (provider: 'google' | 'github') => {
    setError('');
    try {
      await beginAuth(provider);
    } catch {
      setError(`${provider === 'google' ? 'Google' : 'GitHub'} sign-in is not configured yet.`);
    }
  };
  return (
    <div className="loginPage">
      <section className="loginPitch">
        <div className="brand">
          <div className="mark">OC</div>
          <strong>OpenClasp</strong>
        </div>
        <div>
          <p className="eyebrow">AGENT-TO-AGENT ASSURANCE</p>
          <h1>Know who your agent is dealing with.</h1>
          <p>
            Verified identities, signed outcomes, private warnings, and contextual
            reliability—without using message bodies for scoring.
          </p>
        </div>
        <div className="loginProof">
          <span>01</span> User-owned history
          <span>02</span> No universal trust score
          <span>03</span> Explicit network consent
        </div>
      </section>
      <section className="loginCard">
        <div>
          <p className="eyebrow">SECURE ACCESS</p>
          <h2>Sign in to OpenClasp</h2>
          <p>
            Manage connected agents, review signed history, and control what contributes to the
            network.
          </p>
        </div>
        <div className="socialButtons">
          <button type="button" onClick={() => void continueWith('google')}>
            <GoogleMark /> Continue with Google
          </button>
          <button type="button" onClick={() => void continueWith('github')}>
            <GitHubMark /> Continue with GitHub
          </button>
          {onPreview && (
            <button type="button" onClick={() => void onPreview()}>
              Continue with local preview
            </button>
          )}
        </div>
        {error && (
          <div className="loginError" role="alert">
            {error}
          </div>
        )}
        <small>
          Google and GitHub handle authentication. OpenClasp never receives your password.
        </small>
      </section>
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
        body: JSON.stringify({
          code,
          codeVerifier: transaction.verifier,
        }),
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
        <a href="/login">Return to login</a>
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
  if (page === 'history') return <History data={data} />;
  if (page === 'conversations')
    return <Conversations data={data} refreshDashboard={refreshDashboard} api={api} />;
  if (page === 'agents')
    return <Agents data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />;
  if (page === 'insights') return <Insights data={data} />;
  if (page === 'connect')
    return (
      <Connect data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />
    );
  if (page === 'settings')
    return <SettingsPage settings={settings} setSettings={setSettings} api={api} />;
  return <Overview data={data} navigate={navigate} refreshDashboard={refreshDashboard} api={api} />;
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
            <span className="statusOrb">{pendingSetup}</span>
            <div>
              <strong>
                {pendingSetup} setup request{pendingSetup === 1 ? '' : 's'} waiting
              </strong>
              <small>Approve the proposed identity before the agent can be bound.</small>
            </div>
          </div>
        </button>
      )}
      <section
        className={`readiness ${readyAgents === data.agents.length && readyAgents ? 'ready' : ''}`}
      >
        <div>
          <span className="statusOrb">{readyAgents ? '✓' : '!'}</span>
          <div>
            <strong>
              {readyAgents === data.agents.length && readyAgents
                ? 'Your agent network is ready'
                : `${readyAgents} of ${data.agents.length} agents can receive A2A work`}
            </strong>
            <small>
              Safe matching requests activate automatically. Everything else waits for approval.
            </small>
          </div>
        </div>
        <button className="secondary" type="button" onClick={() => navigate('agents')}>
          Manage automation
        </button>
      </section>
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
        <Panel title="Recent activity" subtitle="Structured events and signed outcomes">
          <Timeline events={data.events.slice(-6).reverse()} />
          <TextButton onClick={() => navigate('history')}>View complete history</TextButton>
        </Panel>
        <Panel
          title="Reliability context"
          subtitle="Task-specific profiles, never a universal score"
        >
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
        <strong>Hosted temporary mode.</strong> OpenClasp processes these messages and encrypts them
        at rest for 30 days. Messages between persistent runtimes remain direct and are never shown
        here.
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
  const [status, setStatus] = useState<'all' | 'pending' | 'active' | 'finalizing' | 'completed'>(
    'all',
  );
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
        <input
          className="searchField"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search purpose, category, or agent"
          aria-label="Search interaction history"
        />
        <div className="filterRow" aria-label="Interaction status filters">
          {(['all', 'pending', 'active', 'finalizing', 'completed'] as const).map((value) => (
            <button
              key={value}
              className={status === value ? 'filterChip active' : 'filterChip'}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {value}{' '}
              {value === 'all'
                ? journeys.length
                : journeys.filter((item) => item.status === value).length}
            </button>
          ))}
        </div>
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
            ? 'completed'
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
                ? 'Finalizing'
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
              ? humanize(conclusion.consensus)
              : journey.reports.length === 1
                ? 'One agent finished; confirming with the peer'
                : 'Conversation remains active'}
          </small>
        </section>
        <section>
          <span>Sealed feedback</span>
          <strong>{conclusion ? 'Released' : `${submittedFeedback}/2 submitted`}</strong>
          <small>{feedbackState(journey.feedbackRequests)}</small>
        </section>
        <section>
          <span>Learning</span>
          <strong>
            {journey.eligibility
              ? journey.eligibility.eligible
                ? `${Math.round(Number(journey.eligibility.sampleWeight ?? 0) * 100)}% weight`
                : 'Not eligible'
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
            <span className="eyebrow">WHAT HAPPENED</span>
            <h3>{conclusion.summary}</h3>
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
  const steps: { at: string; title: string; detail: string; status: string; tone: string }[] = [
    {
      at: String(journey.interaction.createdAt ?? journey.updatedAt),
      title: 'Contract proposed',
      detail: `${journey.participants.length || 2} participants · ${journey.taskCategory}`,
      status: String(journey.interaction.status ?? 'recorded'),
      tone: 'neutral',
    },
    ...journey.briefs.map((brief) => ({
      at: String(brief.generatedAt ?? journey.updatedAt),
      title: `Private counterparty brief for ${brief.recipientAgentId}`,
      detail: `${brief.relevantSampleSize ?? 0} relevant samples · ${Math.round(Number(brief.historyConfidence ?? 0) * 100)}% history confidence`,
      status: String(brief.decision ?? 'ready'),
      tone: brief.decision === 'DENY' ? 'danger' : brief.decision === 'CHALLENGE' ? 'warn' : 'good',
    })),
    ...Object.values(journey.interaction.acceptances ?? {}).map((acceptance: any) => ({
      at: String(acceptance.acceptedAt ?? journey.interaction.updatedAt ?? journey.updatedAt),
      title: `Contract accepted by ${acceptance.agentId}`,
      detail: `Acceptance method: ${humanize(acceptance.method ?? 'recorded')}`,
      status: 'accepted',
      tone: 'good',
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
            title: 'Bilateral conclusion released',
            detail: String(journey.conclusion.summary),
            status: String(journey.conclusion.consensus),
            tone: journey.conclusion.consensus === 'conflicting' ? 'warn' : 'good',
          },
        ]
      : []),
    ...(journey.receipt
      ? [
          {
            at: timestamp(journey.receipt),
            title: 'Outcome receipt attested',
            detail: 'Contract result, commitment status, and evidence hashes were sealed.',
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
  const incoming = data.federatedInteractions.filter(
    (interaction) =>
      interaction.status === 'pending' && ownedAgentIds.has(String(interaction.responderAgentId)),
  );
  const respond = async (interactionId: string, agentId: string, decision: 'accept' | 'reject') => {
    setWorking(interactionId);
    setError('');
    try {
      await api(`/v0.1/federated-interactions/${encodeURIComponent(interactionId)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ agentId, decision }),
      });
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
      title={incoming.length ? `Agent invitations (${incoming.length})` : 'Shared interactions'}
      subtitle="Both accounts see the same immutable contract and acceptance state"
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
            <small>Contract: {String(interaction.termsHash).slice(0, 16)}…</small>
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
          {interaction.status === 'pending' &&
          ownedAgentIds.has(String(interaction.responderAgentId)) ? (
            <div className="decisionButtons">
              <button
                className="secondary"
                type="button"
                disabled={working === interaction.interactionId}
                onClick={() =>
                  void respond(interaction.interactionId, interaction.responderAgentId, 'reject')
                }
              >
                Reject
              </button>
              <button
                className="primary"
                type="button"
                disabled={working === interaction.interactionId}
                onClick={() =>
                  void respond(interaction.interactionId, interaction.responderAgentId, 'accept')
                }
              >
                {working === interaction.interactionId ? 'Working…' : 'Accept contract'}
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
  return (
    <>
      <PageHead page="insights" />
      <section className="insightPrinciple">
        <div>
          <span className="eyebrow">HOW TO READ THIS</span>
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
        </div>
      </section>
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
  const endpoint = 'https://openclasp.vercel.app/mcp';
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
            <p className="eyebrow">CONFIRMATION REQUIRED</p>
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
        <p className="eyebrow">{meta.eyebrow}</p>
        <h1>{meta.title}</h1>
        <p className="lede">{meta.lede}</p>
      </div>
      {action && (
        <button className="primary" type="button" onClick={onAction}>
          {action}
        </button>
      )}
    </header>
  );
}
function Nav({
  page,
  active,
  onClick,
  label,
  icon,
  badge = 0,
}: {
  page: Page;
  active: Page;
  onClick: (page: Page) => void;
  label: string;
  icon: IconName;
  badge?: number;
}) {
  return (
    <button
      className={active === page ? 'active' : ''}
      type="button"
      aria-current={active === page ? 'page' : undefined}
      onClick={() => onClick(page)}
    >
      <Icon name={icon} />
      {label}
      {badge > 0 ? <span className="navBadge">{badge}</span> : null}
    </button>
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
    <article className={warn ? 'metric warn' : 'metric'}>
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
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
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
          <Icon name="agents" />
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
        <a
          href={`/agents/${encodeURIComponent(agent.agentId)}/card.json`}
          target="_blank"
          rel="noreferrer"
        >
          Public Agent Card
        </a>
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
      <Icon name="agents" />
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

type IconName =
  'home' | 'history' | 'agents' | 'insights' | 'connect' | 'settings' | 'sun' | 'moon';

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'home' && <path d="M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />}
      {name === 'history' && (
        <>
          <path d="M4 12a8 8 0 1 0 2.2-5.5" />
          <path d="M4 4v5h5" />
          <path d="M12 8v5l3 2" />
        </>
      )}
      {name === 'agents' && (
        <>
          <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
          <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
          <path d="M4 20v-1a4 4 0 0 1 4-4h1" />
          <path d="M20 20v-1a4 4 0 0 0-4-4h-1" />
        </>
      )}
      {name === 'insights' && (
        <>
          <path d="M4 19h16" />
          <path d="M7 16V9" />
          <path d="M12 16V5" />
          <path d="M17 16v-6" />
        </>
      )}
      {name === 'connect' && (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      )}
      {name === 'settings' && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M16.9 16.9l1.5 1.5M5.6 18.4l1.4-1.4M16.9 7.1l1.5-1.5" />
        </>
      )}
      {name === 'sun' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </>
      )}
      {name === 'moon' && <path d="M16 13a6 6 0 0 1-7.8-7.8A7 7 0 1 0 16 13" />}
    </svg>
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
      : ['partial', 'pending', 'challenge', 'conflict', 'expired', 'excluded'].some((item) =>
            normalized.includes(item),
          )
        ? 'warn'
        : 'neutral';
  return <span className={`statusPill ${tone}`}>{humanize(value)}</span>;
}

function initials(value: string) {
  return value
    .split(/\s+|@/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
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
