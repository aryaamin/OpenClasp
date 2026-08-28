import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type DashboardData = {
  agents: any[];
  events: any[];
  conflicts: any[];
  receipts: any[];
  profiles: any[];
};
const empty: DashboardData = { agents: [], events: [], conflicts: [], receipts: [], profiles: [] };

function App() {
  const [data, setData] = useState(empty);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const apiBase = location.hostname === 'localhost' ? 'http://localhost:3100' : location.origin;
    fetch(`${apiBase}/v0.1/dashboard`)
      .then((response) => response.json())
      .then(setData)
      .catch(() => setOffline(true));
  }, []);
  const bilateral = data.receipts.filter((receipt) => !receipt.unilateral).length;
  return (
    <main>
      <header>
        <div className="mark">OC</div>
        <div>
          <p className="eyebrow">ASSURANCE LAYER / V0.1</p>
          <h1>OpenClasp</h1>
        </div>
        <span className={offline ? 'status offline' : 'status'}>
          {offline ? 'API OFFLINE' : 'LOCAL NETWORK'}
        </span>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">AGENT COORDINATION</p>
          <h2>
            Trust is contextual.
            <br />
            <em>Evidence makes it useful.</em>
          </h2>
          <p>
            Verify identities, watch agreements, surface clues, and learn from signed
            outcomes—without owning the conversation.
          </p>
        </div>
        <div className="signal">
          <span>Current posture</span>
          <strong>{data.profiles.length ? 'LEARNING' : 'AWAITING EVIDENCE'}</strong>
          <small>Raw messages remain local</small>
        </div>
      </section>
      <section className="metrics">
        <Metric label="Verified agents" value={data.agents.length} />
        <Metric label="Structured events" value={data.events.length} />
        <Metric label="Bilateral receipts" value={bilateral} />
        <Metric label="Contextual profiles" value={data.profiles.length} />
      </section>
      <section className="grid">
        <Panel title="Agent lineage" subtitle="Identity, operator, and version">
          {data.agents.length ? (
            data.agents.map((agent) => (
              <article className="row" key={agent.agentId}>
                <span className="dot" />
                <div>
                  <strong>{agent.agentId}</strong>
                  <small>
                    {agent.operatorRef} · v{agent.agentVersion}
                  </small>
                </div>
                <b>{agent.revoked ? 'REVOKED' : 'VERIFIED'}</b>
              </article>
            ))
          ) : (
            <Empty text="Run pnpm demo or register an agent through the API." />
          )}
        </Panel>
        <Panel title="Behavioural context" subtitle="Task-specific, never universal">
          {data.profiles.length ? (
            data.profiles.map((profile) => (
              <article className="profile" key={`${profile.agentId}${profile.taskCategory}`}>
                <div>
                  <strong>{profile.agentId}</strong>
                  <small>
                    {profile.taskCategory} · {profile.sampleSize} signed outcome(s)
                  </small>
                </div>
                <Meter value={profile.completion} label="completion" />
                <Meter value={profile.scope} label="scope" />
              </article>
            ))
          ) : (
            <Empty text="Profiles grow only from verified receipts and eligible feedback." />
          )}
        </Panel>
        <Panel title="Interaction timeline" subtitle="Attributable structured events">
          {data.events.length ? (
            data.events
              .slice(-6)
              .reverse()
              .map((event) => (
                <article className="row" key={event.eventId}>
                  <span className={`dot ${event.eventType}`} />
                  <div>
                    <strong>{event.eventType.replaceAll('_', ' ')}</strong>
                    <small>
                      {event.agentId} · {new Date(event.timestamp).toLocaleTimeString()}
                    </small>
                  </div>
                  <b>{event.visibility}</b>
                </article>
              ))
          ) : (
            <Empty text="No structured events recorded yet." />
          )}
        </Panel>
        <Panel title="Mediation and receipts" subtitle="Shared only with explicit consent">
          <div className="split">
            <div>
              <strong>{data.conflicts.filter((item) => item.status === 'resolved').length}</strong>
              <small>resolved conflicts</small>
            </div>
            <div>
              <strong>{data.receipts.length}</strong>
              <small>signed receipts</small>
            </div>
          </div>
          <p className="note">
            Unilateral receipts are labelled separately and never treated as bilateral proof.
          </p>
        </Panel>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{String(value).padStart(2, '0')}</strong>
    </div>
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
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span>↗</span>
      </div>
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <i>
        <b style={{ width: `${value * 100}%` }} />
      </i>
      <strong>{Math.round(value * 100)}%</strong>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
