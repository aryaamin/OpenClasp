import { useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { FrameCorners } from '@/components/agent-mark';

type RecordValue = Record<string, any>;

type FirstRunGuideProps = {
  data: {
    agents: RecordValue[];
    publications: RecordValue[];
    runtimes: RecordValue[];
  };
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  refreshDashboard: () => Promise<void>;
};

export function FirstRunGuide({ data, api, refreshDashboard }: FirstRunGuideProps) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const agent = data.agents.find((candidate) => candidate.status !== 'revoked');
  const agentId = String(agent?.agentId ?? '');
  const runtime = data.runtimes.find(
    (candidate) => candidate.agentId === agentId && candidate.status === 'verified',
  );
  const published = data.publications.some(
    (candidate) => candidate.agentId === agentId && candidate.published,
  );

  if (agent && published) return null;

  const publishAgent = async () => {
    setWorking(true);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(agentId)}/publication`, {
        method: 'POST',
        body: JSON.stringify({ published: true }),
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not publish Agent Card');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="firstRunGuide" aria-labelledby="first-run-title">
      <FrameCorners />
      <header className="firstRunHeader">
        <div>
          <h2 id="first-run-title">Connect your first cloud agent</h2>
          <p>Choose its provider. OpenClasp handles the runtime connection in the background.</p>
        </div>
        <span className="firstRunCount">{agent ? (runtime ? '2/2' : '1/2') : '0/2'}</span>
      </header>

      {error ? (
        <div className="errorBar" role="alert">
          {error}
        </div>
      ) : null}

      {!agent ? (
        <div className="firstRunReview">
          <div className="firstRunStage">
            <span className="firstRunIcon">01</span>
            <div>
              <strong>Choose the agent provider</strong>
              <p>Botpress is available now. You enter only the agent name.</p>
            </div>
          </div>
          <a className="primary" href="/connect">
            Connect provider <ExternalLink />
          </a>
        </div>
      ) : !runtime ? (
        <div className="firstRunReview">
          <div className="firstRunStage">
            <span className="firstRunIcon">02</span>
            <div>
              <strong>Waiting for runtime verification</strong>
              <p>Keep the connector running. OpenClasp will verify its public HTTPS endpoint.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="firstRunReview">
          <div className="firstRunStage">
            <span className="firstRunIcon complete">
              <Check />
            </span>
            <div>
              <strong>Runtime verified</strong>
              <p>Review the agent-declared profile below, then publish it to the marketplace.</p>
            </div>
          </div>
          <article className="agentCardPreview">
            <span className="verifiedPublisher">✓ Runtime verified</span>
            <h3>{String(agent.name)}</h3>
            <p>{String(agent.description)}</p>
            <small>Profile details are self-declared by the connected agent.</small>
          </article>
          <button className="primary" type="button" disabled={working} onClick={publishAgent}>
            {working ? 'Publishing…' : 'Publish Agent Card'}
          </button>
        </div>
      )}
    </section>
  );
}
