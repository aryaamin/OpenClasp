import {
  AuthenticateWithRedirectCallback,
  ClerkProvider,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/react';
import { useSignIn } from '@clerk/react/legacy';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

declare const __CLERK_PUBLISHABLE_KEY__: string;

type DashboardData = {
  agents: Record<string, any>[];
  interactions: Record<string, any>[];
  events: Record<string, any>[];
  conflicts: Record<string, any>[];
  receipts: Record<string, any>[];
  profiles: Record<string, any>[];
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
  interactions: [],
  events: [],
  conflicts: [],
  receipts: [],
  profiles: [],
};
const defaultSettings: Settings = {
  displayName: '',
  contributionEnabled: false,
  retentionDays: 30,
  evidenceSharing: 'ask',
  rawConversationsStored: false,
};
const pages = ['dashboard', 'history', 'agents', 'insights', 'connect', 'settings'] as const;
type Page = (typeof pages)[number];

let getAuthToken: () => Promise<string | null> = async () => null;

async function api(path: string, init?: RequestInit) {
  const token = await getAuthToken();
  return fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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

function App() {
  const { isLoaded: isAuthLoaded, isSignedIn, getToken } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const { signOut } = useClerk();
  const [page, setPage] = useState<Page>(route());
  const [data, setData] = useState<DashboardData>(emptyData);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const onPopState = () => setPage(route());
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    getAuthToken = getToken;
    if (isAuthLoaded && !isSignedIn && location.pathname !== '/login')
      history.replaceState({}, '', '/login');
    if (!isSignedIn) return;
    if (location.pathname === '/login') history.replaceState({}, '', '/dashboard');
    setPage(route());
    Promise.all([api('/v0.1/dashboard'), api('/v0.1/settings')])
      .then(([dashboard, accountSettings]) => {
        setData(dashboard as DashboardData);
        setSettings(accountSettings as Settings);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Load failed'),
      )
      .finally(() => setLoading(false));
  }, [getToken, isAuthLoaded, isSignedIn]);

  const navigate = (next: Page) => {
    history.pushState({}, '', `/${next}`);
    setPage(next);
  };

  if (!isAuthLoaded || !isUserLoaded) return <Loading />;
  if (!isSignedIn) return <Login />;

  return (
    <div className="appShell">
      <aside>
        <div className="brand">
          <div className="mark">OC</div>
          <div>
            <strong>OpenClasp</strong>
            <small>ASSURANCE NETWORK</small>
          </div>
        </div>
        <nav>
          <Nav page="dashboard" active={page} onClick={navigate} label="Overview" glyph="⌂" />
          <Nav page="history" active={page} onClick={navigate} label="History" glyph="≡" />
          <Nav page="agents" active={page} onClick={navigate} label="Agents" glyph="◇" />
          <Nav page="insights" active={page} onClick={navigate} label="Insights" glyph="⌁" />
          <Nav page="connect" active={page} onClick={navigate} label="Connect" glyph="+" />
          <Nav page="settings" active={page} onClick={navigate} label="Settings" glyph="⚙" />
        </nav>
        <div className="privacyStamp">
          <span className="liveDot" />
          <div>
            <strong>Structured-only</strong>
            <small>Raw conversations stay local</small>
          </div>
        </div>
        <button className="account" onClick={() => void signOut({ redirectUrl: '/login' })}>
          <span>{initials(user?.fullName || user?.primaryEmailAddress?.emailAddress || 'OC')}</span>
          <div>
            <strong>{user?.fullName || 'OpenClasp user'}</strong>
            <small>{user?.primaryEmailAddress?.emailAddress || 'Sign out'}</small>
          </div>
          <b>↗</b>
        </button>
      </aside>
      <main>
        {error && <div className="errorBar">{error}</div>}
        {loading ? (
          <Loading compact />
        ) : (
          <PageContent
            page={page}
            data={data}
            settings={settings}
            setSettings={setSettings}
            navigate={navigate}
          />
        )}
      </main>
    </div>
  );
}

function Login() {
  const { isLoaded, signIn } = useSignIn();
  const [error, setError] = useState('');
  const continueWith = async (provider: 'google' | 'github') => {
    setError('');
    try {
      if (!isLoaded) return;
      await signIn.authenticateWithRedirect({
        strategy: provider === 'google' ? 'oauth_google' : 'oauth_github',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/dashboard',
      });
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
            reliability—without collecting raw conversations.
          </p>
        </div>
        <div className="loginProof">
          <span>01</span> User-owned history<span>02</span> No universal trust score<span>03</span>{' '}
          Explicit network consent
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
          <button onClick={() => void continueWith('google')}>
            <span className="google">G</span> Continue with Google
          </button>
          <button onClick={() => void continueWith('github')}>
            <span>◉</span> Continue with GitHub
          </button>
        </div>
        {error && <div className="loginError">{error}</div>}
        <small>
          Google and GitHub handle authentication. OpenClasp never receives your password.
        </small>
      </section>
    </div>
  );
}

function PageContent({
  page,
  data,
  settings,
  setSettings,
  navigate,
}: {
  page: Page;
  data: DashboardData;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  navigate: (page: Page) => void;
}) {
  if (page === 'history') return <History data={data} />;
  if (page === 'agents') return <Agents data={data} navigate={navigate} />;
  if (page === 'insights') return <Insights data={data} />;
  if (page === 'connect') return <Connect />;
  if (page === 'settings') return <SettingsPage settings={settings} setSettings={setSettings} />;
  return <Overview data={data} navigate={navigate} />;
}

function Overview({ data, navigate }: { data: DashboardData; navigate: (page: Page) => void }) {
  const completed = data.receipts.filter((item) => item.outcome === 'success').length;
  const warnings = data.events.filter((item) =>
    ['policy_warning', 'policy_violation', 'objection'].includes(String(item.eventType)),
  ).length;
  return (
    <>
      <PageHead
        eyebrow="NETWORK OVERVIEW"
        title="Assurance, at a glance."
        action="Connect agent"
        onAction={() => navigate('connect')}
      />
      <section className="metrics">
        <Metric label="Connected agents" value={data.agents.length} note="verified identities" />
        <Metric label="Interactions" value={data.interactions.length} note="signed or active" />
        <Metric label="Successful outcomes" value={completed} note="receipt-backed" />
        <Metric label="Open warnings" value={warnings} note="needs attention" warn={warnings > 0} />
      </section>
      <section className="contentGrid">
        <Panel title="Recent activity" subtitle="Structured events and signed outcomes">
          <Timeline events={data.events.slice(-6).reverse()} />
          <TextButton onClick={() => navigate('history')}>View complete history →</TextButton>
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

function History({ data }: { data: DashboardData }) {
  const records = useMemo(
    () =>
      [
        ...data.interactions.map((value) => ({ ...value, _kind: 'interaction' })),
        ...data.events.map((value) => ({ ...value, _kind: 'event' })),
        ...data.receipts.map((value) => ({ ...value, _kind: 'receipt' })),
        ...data.conflicts.map((value) => ({ ...value, _kind: 'dispute' })),
      ].sort((a, b) => Date.parse(timestamp(b)) - Date.parse(timestamp(a))),
    [data],
  );
  return (
    <>
      <PageHead eyebrow="AUDIT HISTORY" title="What happened, and what proves it." />
      <Panel
        title="Account history"
        subtitle="Only structured metadata, signatures, hashes, and permitted evidence are hosted"
      >
        {records.length ? (
          records.map((item, index) => (
            <HistoryRow
              key={String(
                (item as Record<string, any>).eventId ??
                  (item as Record<string, any>).receiptId ??
                  (item as Record<string, any>).interactionId ??
                  index,
              )}
              item={item}
            />
          ))
        ) : (
          <Empty
            title="No interactions recorded"
            text="Connect an agent and start an assured interaction. Raw message bodies will not appear here."
          />
        )}
      </Panel>
    </>
  );
}

function Agents({ data, navigate }: { data: DashboardData; navigate: (page: Page) => void }) {
  return (
    <>
      <PageHead
        eyebrow="IDENTITY REGISTRY"
        title="Your connected agents."
        action="Connect agent"
        onAction={() => navigate('connect')}
      />
      <section className="agentGrid">
        {data.agents.length ? (
          data.agents.map((agent) => <AgentCard key={agent.agentId} agent={agent} />)
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

function Insights({ data }: { data: DashboardData }) {
  return (
    <>
      <PageHead eyebrow="BEHAVIOURAL CONTEXT" title="Evidence, not reputation theatre." />
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

function Connect() {
  const endpoint = 'https://openclasp.vercel.app/mcp';
  const [copied, setCopied] = useState(false);
  return (
    <>
      <PageHead eyebrow="AGENT CONNECTION" title="Add OpenClasp to an agent." />
      <section className="connectLayout">
        <Panel title="Remote MCP endpoint" subtitle="For OAuth-capable MCP clients">
          <div className="endpoint">
            <code>{endpoint}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(endpoint);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol>
            <li>Add the URL as a remote MCP server in your agent or framework.</li>
            <li>The client discovers OAuth and opens the Descope login page.</li>
            <li>Sign in with this account and approve access.</li>
            <li>Ask the agent to create and register its OpenClasp identity.</li>
          </ol>
        </Panel>
        <Panel
          title="What the agent receives"
          subtitle="Assurance tools, not a replacement transport"
        >
          <ul className="checkList">
            <li>Identity and delegation verification</li>
            <li>Counterparty-specific reliability clues</li>
            <li>Signed contracts, events, feedback, and receipts</li>
            <li>Policy challenges and consented mediation</li>
            <li>No hidden rewriting or raw-message upload</li>
          </ul>
        </Panel>
      </section>
    </>
  );
}

function SettingsPage({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    const updated = (await api('/v0.1/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })) as Settings;
    setSettings(updated);
    setSaving(false);
    setSaved(true);
  }, [settings, setSettings]);
  return (
    <>
      <PageHead eyebrow="ACCOUNT CONTROLS" title="Privacy and network settings." />
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
          label="Raw conversations"
          description="Message bodies remain local and user-owned. This cannot be enabled on the hosted service."
        >
          <span className="locked">ALWAYS OFF</span>
        </Setting>
        <div className="saveRow">
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && <span>Saved</span>}
        </div>
      </section>
    </>
  );
}

function PageHead({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className="pageHead">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action && (
        <button className="primary" onClick={onAction}>
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
  glyph,
}: {
  page: Page;
  active: Page;
  onClick: (page: Page) => void;
  label: string;
  glyph: string;
}) {
  return (
    <button className={active === page ? 'active' : ''} onClick={() => onClick(page)}>
      <span>{glyph}</span>
      {label}
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
      <strong>{String(value).padStart(2, '0')}</strong>
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
function AgentCard({ agent }: { agent: Record<string, any> }) {
  return (
    <article className="agentCard">
      <div className="agentTop">
        <span className="agentGlyph">◇</span>
        <b className={agent.revoked ? 'bad' : ''}>{agent.revoked ? 'REVOKED' : 'VERIFIED'}</b>
      </div>
      <h2>{agent.agentId}</h2>
      <p>Version {agent.agentVersion}</p>
      <div className="tags">
        {(agent.capabilities ?? []).slice(0, 4).map((capability: string) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
      <small>Created {new Date(agent.createdAt).toLocaleDateString()}</small>
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
      <span>◇</span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
function TextButton({ children, onClick }: React.PropsWithChildren<{ onClick: () => void }>) {
  return (
    <button className="textButton" onClick={onClick}>
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
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className={checked ? 'toggle on' : 'toggle'}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Loading({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? 'loading compact' : 'loading'}>
      <span className="mark">OC</span>
      <p>Verifying session…</p>
    </div>
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

if (!__CLERK_PUBLISHABLE_KEY__) throw new Error('Clerk publishable key is not configured');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={__CLERK_PUBLISHABLE_KEY__} afterSignOutUrl="/login">
      {location.pathname === '/sso-callback' ? <AuthenticateWithRedirectCallback /> : <App />}
    </ClerkProvider>
  </React.StrictMode>,
);
