import { useState, type FormEvent } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { FrameCorners } from '@/components/agent-mark';

type RecordValue = Record<string, any>;

type FirstRunData = {
  agents: RecordValue[];
  publications: RecordValue[];
};

type FirstRunGuideProps = {
  data: FirstRunData;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  refreshDashboard: () => Promise<void>;
};

const splitList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function FirstRunGuide({ data, api, refreshDashboard }: FirstRunGuideProps) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [agentForm, setAgentForm] = useState({
    agentName: '',
    description: '',
    framework: '',
    capabilities: '',
  });

  const agent = data.agents.find((candidate) => candidate.status !== 'revoked');
  const agentId = String(agent?.agentId ?? '');
  const publication = data.publications.find(
    (candidate) => candidate.agentId === agentId && candidate.published,
  );
  const published = Boolean(publication);
  const cardUrl = String(
    publication?.cardUrl ||
      (agentId ? `${window.location.origin}/agents/${encodeURIComponent(agentId)}/card.json` : ''),
  );
  const shareUrl = String(publication?.profileUrl || cardUrl);
  const steps = [
    { label: 'Add agent', done: Boolean(agent) },
    { label: 'Publish card', done: published },
  ];

  const createAgent = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      await api('/v0.1/quickstart/agent', {
        method: 'POST',
        body: JSON.stringify({
          agentName: agentForm.agentName,
          projectName: 'My agents',
          description: agentForm.description,
          framework: agentForm.framework || 'Custom agent',
          capabilities: splitList(agentForm.capabilities),
          limitations: [],
        }),
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add agent');
    } finally {
      setWorking(false);
    }
  };

  const publishAgent = async () => {
    setWorking(true);
    setError('');
    try {
      await api(`/v0.1/agents/${encodeURIComponent(agentId)}/publication`, {
        method: 'POST',
        body: JSON.stringify({ published: true }),
      });
      setJustPublished(true);
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not publish Agent Card');
    } finally {
      setWorking(false);
    }
  };

  const copyShareLink = async () => {
    setError('');
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError('Could not copy the link. Open it and copy it from your browser.');
    }
  };

  if (agent && published && !justPublished) return null;

  return (
    <section className="firstRunGuide" aria-labelledby="first-run-title">
      <FrameCorners />
      <header className="firstRunHeader">
        <div>
          <h2 id="first-run-title">Public Agent Card</h2>
          <p>Add the agent you run elsewhere, review its public details, then publish one link.</p>
        </div>
        <span className="firstRunCount">{steps.filter((step) => step.done).length}/2</span>
      </header>

      <ol className="firstRunSteps twoSteps">
        {steps.map((step, index) => (
          <li
            className={step.done ? 'done' : ''}
            aria-current={
              !step.done && steps.slice(0, index).every((item) => item.done) ? 'step' : undefined
            }
            key={step.label}
          >
            <span>{step.done ? <Check /> : index + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="errorBar" role="alert">
          {error}
        </div>
      ) : null}

      {!agent ? (
        <form className="firstRunForm" onSubmit={(event) => void createAgent(event)}>
          <div className="firstRunStage">
            <span className="firstRunIcon">01</span>
            <div>
              <strong>Add your agent</strong>
              <p>OpenClasp creates its identity and card. It does not host or run the agent.</p>
            </div>
          </div>
          <label>
            <span>Agent name</span>
            <input
              required
              maxLength={100}
              value={agentForm.agentName}
              onChange={(event) =>
                setAgentForm((current) => ({ ...current, agentName: event.target.value }))
              }
              placeholder="Research assistant"
            />
          </label>
          <label>
            <span>Framework or platform</span>
            <input
              maxLength={100}
              value={agentForm.framework}
              onChange={(event) =>
                setAgentForm((current) => ({ ...current, framework: event.target.value }))
              }
              placeholder="LangGraph, CrewAI, custom…"
            />
          </label>
          <label className="fullWidth">
            <span>Description</span>
            <input
              required
              maxLength={500}
              value={agentForm.description}
              onChange={(event) =>
                setAgentForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Researches markets and returns sourced findings"
            />
          </label>
          <label className="fullWidth">
            <span>Capabilities</span>
            <input
              required
              value={agentForm.capabilities}
              onChange={(event) =>
                setAgentForm((current) => ({ ...current, capabilities: event.target.value }))
              }
              placeholder="market research, source verification"
            />
          </label>
          <button className="primary" type="submit" disabled={working}>
            {working ? 'Adding…' : 'Add agent'}
          </button>
        </form>
      ) : !published ? (
        <div className="firstRunReview">
          <div className="firstRunStage">
            <span className="firstRunIcon">02</span>
            <div>
              <strong>Review what becomes public</strong>
              <p>Publishing makes this profile and its machine-readable Agent Card public.</p>
            </div>
          </div>
          <article className="agentCardPreview">
            <span className="verifiedPublisher">✓ Publisher verified</span>
            <h3>{String(agent.name)}</h3>
            <p>{String(agent.description)}</p>
            <dl>
              <div>
                <dt>Framework</dt>
                <dd>{String(agent.framework)}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>{(agent.capabilities as string[]).join(', ')}</dd>
              </div>
            </dl>
            <small>
              OpenClasp verifies control of the publishing account. Capabilities are self-declared.
            </small>
          </article>
          <button className="primary" type="button" disabled={working} onClick={publishAgent}>
            {working ? 'Publishing…' : 'Publish Agent Card'}
          </button>
        </div>
      ) : (
        <div className="firstRunComplete" role="status">
          <span className="firstRunIcon complete">
            <Check />
          </span>
          <div>
            <strong>Your Agent Card is public</strong>
            <p>Share this public profile with people or other agents.</p>
            <a href={shareUrl} target="_blank" rel="noreferrer">
              {shareUrl}
            </a>
          </div>
          <div className="firstRunActions">
            <button type="button" className="secondary" onClick={() => void copyShareLink()}>
              <Copy /> {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className="secondary" href={shareUrl} target="_blank" rel="noreferrer">
              Open <ExternalLink />
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
