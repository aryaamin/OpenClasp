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
    setData((await remoteApi('/v0.1/dashboard')) as DashboardData);
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
        setData(dashboard as DashboardData);
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
  const pendingSetup = data.setupRequests.filter((request) => request.status === 'pending').length;
  const reviewCount = warnings + pendingInvitations;
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
          note="warnings or approvals"
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
            data.profiles
              .slice(0, 4)
              .map((profile) => (
                <Profile key={`${profile.agentId}-${profile.taskCategory}`} profile={profile} />
              ))
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

type HistoryFilter = 'all' | 'interaction' | 'event' | 'receipt' | 'dispute';

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
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const records = useMemo(
    () =>
      [
        ...data.interactions.map((value) => ({ ...value, _kind: 'interaction' })),
        ...data.federatedInteractions.map((value) => ({
          ...value,
          _kind: 'federated interaction',
        })),
        ...data.events.map((value) => ({ ...value, _kind: 'event' })),
        ...data.receipts.map((value) => ({ ...value, _kind: 'receipt' })),
        ...data.conflicts.map((value) => ({ ...value, _kind: 'dispute' })),
      ].sort((a, b) => Date.parse(timestamp(b)) - Date.parse(timestamp(a))),
    [data],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((item) => {
      const kind = String(item._kind);
      if (filter === 'interaction' && !kind.includes('interaction')) return false;
      if (filter === 'event' && kind !== 'event') return false;
      if (filter === 'receipt' && kind !== 'receipt') return false;
      if (filter === 'dispute' && kind !== 'dispute') return false;
      if (!needle) return true;
      const record = item as Record<string, any>;
      const hay = [
        record.eventType,
        record._kind,
        record.agentId,
        record.interactionId,
        record.receiptId,
        record.outcome,
        record.status,
        record.visibility,
        record.contract?.purpose,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [filter, query, records]);
  const count = (value: HistoryFilter) =>
    value === 'all'
      ? records.length
      : records.filter((item) =>
          value === 'interaction'
            ? String(item._kind).includes('interaction')
            : item._kind === value,
        ).length;
  return (
    <>
      <PageHead page="history" />
      <Panel
        title="Account history"
        subtitle="Only structured metadata, signatures, hashes, and permitted evidence are hosted"
      >
        <div className="toolbar">
          <input
            className="searchField"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents, contracts, or statuses"
            aria-label="Search history"
          />
          <div className="filterRow" role="tablist" aria-label="History filters">
            {(
              [
                ['all', 'All'],
                ['interaction', 'Interactions'],
                ['event', 'Events'],
                ['receipt', 'Receipts'],
                ['dispute', 'Disputes'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'filterChip active' : 'filterChip'}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label} {count(value)}
              </button>
            ))}
          </div>
        </div>
        {filtered.length ? (
          filtered.map((item, index) => (
            <HistoryRow
              key={`${String(item._kind)}-${String(
                (item as Record<string, any>).eventId ??
                  (item as Record<string, any>).receiptId ??
                  (item as Record<string, any>).conflictId ??
                  (item as Record<string, any>).interactionId ??
                  index,
              )}`}
              item={item}
            />
          ))
        ) : (
          <Empty
            title={records.length ? 'No matching records' : 'No interactions recorded'}
            text={
              records.length
                ? 'Try another filter or clear the search.'
                : 'Connect an agent and start an assured interaction. Raw message bodies will not appear here.'
            }
          />
        )}
      </Panel>
    </>
  );
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
  return (
    <>
      <PageHead page="insights" />
      <div className="notice">
        <strong>Context matters.</strong> OpenClasp profiles an agent by task category and version.
        It does not produce a single universal trust score.
      </div>
      <section className="agentGrid">
        {data.profiles.length ? (
          data.profiles.map((profile) => (
            <Panel
              key={`${profile.agentId}-${profile.taskCategory}`}
              title={profile.agentId}
              subtitle={`${profile.taskCategory} · v${profile.agentVersion}`}
            >
              <Profile profile={profile} expanded />
            </Panel>
          ))
        ) : (
          <Empty
            title="Not enough verified evidence"
            text="Insights grow only from signed outcomes, eligible feedback, corrections, disputes, and version-aware history."
          />
        )}
      </section>
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
function Profile({ profile, expanded }: { profile: Record<string, any>; expanded?: boolean }) {
  const dimensions = [
    ['Completion', profile.completion],
    ['Scope', profile.scope],
    ['Evidence', profile.evidence],
    ...(expanded
      ? [
          ['Communication', profile.communication],
          ['Deadline', profile.deadline],
        ]
      : []),
  ] as [string, number][];
  return (
    <article className="profile">
      <div>
        <strong>{profile.agentId}</strong>
        <small>
          {profile.taskCategory} · {profile.sampleSize} outcome(s)
        </small>
      </div>
      {dimensions.map(([label, value]) => (
        <Meter key={label} label={label} value={value ?? 0} />
      ))}
    </article>
  );
}
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.round(value * 100)}%` }} />
      </i>
      <strong>{Math.round(value * 100)}%</strong>
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

function initials(value: string) {
  return value
    .split(/\s+|@/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
function timestamp(item: Record<string, any>) {
  return String(item.timestamp ?? item.completedAt ?? item.createdAt ?? new Date(0).toISOString());
}

if (!__AUTH0_DOMAIN__ || !__AUTH0_CLIENT_ID__ || !__AUTH0_AUDIENCE__)
  throw new Error('Auth0 public configuration is incomplete');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname === '/sso-callback' ? <AuthCallback /> : <App />}
  </React.StrictMode>,
);
