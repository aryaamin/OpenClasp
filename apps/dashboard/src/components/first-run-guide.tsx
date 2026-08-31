import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, Check, Circle, MessageCircle, ShieldCheck } from 'lucide-react';

type RecordValue = Record<string, any>;

type FirstRunData = {
  agents: RecordValue[];
  publications: RecordValue[];
  federatedInteractions: RecordValue[];
  hostedThreads: RecordValue[];
  completionReports: RecordValue[];
  feedbackRequests: RecordValue[];
  interactionFeedback: RecordValue[];
};

type FirstRunGuideProps = {
  data: FirstRunData;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  refreshDashboard: () => Promise<void>;
  navigate: (page: 'agents' | 'conversations' | 'history') => void;
};

const splitList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function FirstRunGuide({ data, api, refreshDashboard, navigate }: FirstRunGuideProps) {
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [targets, setTargets] = useState<RecordValue[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [agentForm, setAgentForm] = useState({
    agentName: '',
    description: '',
    capabilities: '',
  });
  const [agreementForm, setAgreementForm] = useState({
    responderAgentId: '',
    task: '',
    requestedOutcome: '',
    successCriterion: '',
    deadline: '',
  });
  const [completionForm, setCompletionForm] = useState({
    outcome: 'success' as 'success' | 'partial' | 'failure' | 'cancelled',
    summary: '',
    evidenceReferences: '',
  });
  const [feedbackForm, setFeedbackForm] = useState({
    rating: 5,
    wouldWorkAgain: 'yes' as 'yes' | 'no' | 'unsure',
    privateComment: '',
  });

  const firstAgent = data.agents.find((agent) => agent.status !== 'revoked');
  const firstAgentId = String(firstAgent?.agentId ?? '');
  const firstAgentMode = String(firstAgent?.agentMode ?? '');
  const firstCapability = String(firstAgent?.capabilities?.[0] ?? '');
  const published = data.publications.some(
    (publication) => publication.agentId === firstAgentId && publication.published,
  );
  const interaction = data.federatedInteractions.find(
    (candidate) =>
      candidate.contract?.parties?.includes(firstAgentId) &&
      !['rejected', 'expired', 'cancelled'].includes(String(candidate.status)),
  );
  const interactionId = String(interaction?.interactionId ?? '');
  const completionReport = data.completionReports.find(
    (report) => report.interactionId === interactionId && report.reportingAgentId === firstAgentId,
  );
  const pendingFeedback = data.feedbackRequests.find(
    (request) =>
      request.interactionId === interactionId &&
      request.reviewerAgentId === firstAgentId &&
      request.status === 'pending',
  );
  const feedbackSubmitted = data.interactionFeedback.some(
    (feedback) =>
      feedback.interactionId === interactionId && feedback.reviewerAgentId === firstAgentId,
  );
  const finished = Boolean(interactionId && completionReport && feedbackSubmitted);
  const steps = [
    { label: 'Create agent', done: Boolean(firstAgent) },
    { label: 'Agree safeguards', done: Boolean(interaction) },
    { label: 'Record outcome', done: Boolean(completionReport) },
    { label: 'Give feedback', done: finished },
  ];

  useEffect(() => {
    if (!firstAgentId || !published || interaction) return;
    let cancelled = false;
    setTargetsLoading(true);
    const parameters = new URLSearchParams({ agentId: firstAgentId, limit: '20' });
    const taskCategory = firstCapability.trim();
    if (taskCategory) parameters.set('taskCategory', taskCategory);
    api(`/v0.1/marketplace?${parameters}`)
      .then((value) => {
        if (cancelled) return;
        const available = (value as RecordValue[]).filter(
          (candidate) =>
            candidate.card?.transports?.length &&
            !(
              firstAgentMode === 'temporary_chat' && candidate.card?.agentMode === 'temporary_chat'
            ),
        );
        setTargets(available);
        setAgreementForm((current) => ({
          ...current,
          responderAgentId: available.some(
            (candidate) => candidate.card.agentId === current.responderAgentId,
          )
            ? current.responderAgentId
            : String(available[0]?.card?.agentId ?? ''),
        }));
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not load counterparties');
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, firstAgentId, firstAgentMode, firstCapability, interaction, published]);

  const createAgent = async (event: FormEvent) => {
    event.preventDefault();
    setWorking('agent');
    setError('');
    try {
      await api('/v0.1/quickstart/agent', {
        method: 'POST',
        body: JSON.stringify({
          agentName: agentForm.agentName,
          projectName: 'My agents',
          description: agentForm.description,
          capabilities: splitList(agentForm.capabilities),
          limitations: [],
        }),
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create agent');
    } finally {
      setWorking('');
    }
  };

  const startAgreement = async (event: FormEvent) => {
    event.preventDefault();
    setWorking('agreement');
    setError('');
    try {
      await api('/v0.1/federated-interactions/start', {
        method: 'POST',
        body: JSON.stringify({
          initiatorAgentId: firstAgentId,
          responderAgentId: agreementForm.responderAgentId,
          task: agreementForm.task,
          requestedOutcome: agreementForm.requestedOutcome,
          successCriterion: agreementForm.successCriterion,
          taskCategory: firstCapability || 'general',
          ...(agreementForm.deadline
            ? { deadline: new Date(agreementForm.deadline).toISOString() }
            : {}),
        }),
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start agreement');
    } finally {
      setWorking('');
    }
  };

  const reportOutcome = async (event: FormEvent) => {
    event.preventDefault();
    setWorking('outcome');
    setError('');
    try {
      await api(`/v0.1/federated-interactions/${encodeURIComponent(interactionId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          agentId: firstAgentId,
          outcome: completionForm.outcome,
          summary: completionForm.summary,
          evidenceReferences: splitList(completionForm.evidenceReferences),
        }),
      });
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record outcome');
    } finally {
      setWorking('');
    }
  };

  const submitFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingFeedback) return;
    setWorking('feedback');
    setError('');
    try {
      await api(
        `/v0.1/feedback-requests/${encodeURIComponent(String(pendingFeedback.requestId))}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ agentId: firstAgentId, ...feedbackForm }),
        },
      );
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not submit feedback');
    } finally {
      setWorking('');
    }
  };

  if (finished)
    return (
      <section className="firstRunGuide firstRunComplete" aria-label="First interaction complete">
        <span className="firstRunIcon complete">
          <Check />
        </span>
        <div>
          <strong>First protected interaction recorded</strong>
          <p>The agreement, outcome, and private feedback are now part of your verified history.</p>
        </div>
        <button type="button" className="secondary" onClick={() => navigate('history')}>
          View record <ArrowRight />
        </button>
      </section>
    );

  return (
    <section className="firstRunGuide" aria-labelledby="first-run-title">
      <header className="firstRunHeader">
        <div>
          <p className="eyebrow">guided first run</p>
          <h2 id="first-run-title">Complete one protected interaction</h2>
          <p>Four concrete steps. Every step writes real, structured OpenClasp data.</p>
        </div>
        <span className="firstRunCount">{steps.filter((step) => step.done).length}/4</span>
      </header>
      <ol className="firstRunSteps">
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

      {!firstAgent ? (
        <form className="firstRunForm" onSubmit={(event) => void createAgent(event)}>
          <div className="firstRunStage">
            <span className="firstRunIcon">
              <Bot />
            </span>
            <div>
              <strong>Create a hosted agent identity</strong>
              <p>No infrastructure needed. You can connect a runtime later.</p>
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
            <span>What does it do?</span>
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
          <label>
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
          <button className="primary" type="submit" disabled={working === 'agent'}>
            {working === 'agent' ? 'Creating…' : 'Create and publish agent'}
          </button>
        </form>
      ) : !interaction ? (
        <form className="firstRunForm" onSubmit={(event) => void startAgreement(event)}>
          <div className="firstRunStage">
            <span className="firstRunIcon">
              <ShieldCheck />
            </span>
            <div>
              <strong>Define the agreement before work starts</strong>
              <p>Choose a counterparty, expected result, success test, and deadline.</p>
            </div>
          </div>
          {!published ? (
            <div className="firstRunBlocked">
              <span>This agent is private. Publish it before starting an agreement.</span>
              <button type="button" className="secondary" onClick={() => navigate('agents')}>
                Manage agent
              </button>
            </div>
          ) : targetsLoading ? (
            <div className="firstRunBlocked">Loading available counterparties…</div>
          ) : !targets.length ? (
            <div className="firstRunBlocked">
              No connected persistent counterparties are available yet. Invite a second account or
              connect a persistent runtime.
            </div>
          ) : (
            <>
              <label>
                <span>Counterparty</span>
                <select
                  required
                  value={agreementForm.responderAgentId}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      responderAgentId: event.target.value,
                    }))
                  }
                >
                  {targets.map((target) => (
                    <option value={target.card.agentId} key={target.card.agentId}>
                      {target.card.name} · {Math.round(Number(target.match?.score ?? 0) * 100)}% fit
                    </option>
                  ))}
                </select>
              </label>
              <label className="fullWidth">
                <span>Task</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  value={agreementForm.task}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, task: event.target.value }))
                  }
                  placeholder="Compare three customer-support platforms for a 20-person team."
                />
              </label>
              <label>
                <span>Expected result</span>
                <input
                  required
                  maxLength={1000}
                  value={agreementForm.requestedOutcome}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      requestedOutcome: event.target.value,
                    }))
                  }
                  placeholder="A ranked shortlist with trade-offs"
                />
              </label>
              <label>
                <span>Success means</span>
                <input
                  required
                  maxLength={1000}
                  value={agreementForm.successCriterion}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      successCriterion: event.target.value,
                    }))
                  }
                  placeholder="Three current options with source links"
                />
              </label>
              <label>
                <span>Deadline (optional)</span>
                <input
                  type="datetime-local"
                  value={agreementForm.deadline}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, deadline: event.target.value }))
                  }
                />
              </label>
              <button className="primary" type="submit" disabled={working === 'agreement'}>
                {working === 'agreement' ? 'Sending…' : 'Send protected request'}
              </button>
            </>
          )}
        </form>
      ) : interaction.status === 'pending' ? (
        <div className="firstRunWaiting">
          <span className="firstRunIcon">
            <Circle />
          </span>
          <div>
            <strong>Waiting for counterparty approval</strong>
            <p>{interaction.contract?.purpose}</p>
            <small>
              The task cannot start until both agents accept the same terms hash. This page updates
              automatically.
            </small>
          </div>
        </div>
      ) : interaction.status === 'active' && !completionReport ? (
        <form className="firstRunForm" onSubmit={(event) => void reportOutcome(event)}>
          <div className="firstRunStage">
            <span className="firstRunIcon">
              <MessageCircle />
            </span>
            <div>
              <strong>Agreement active — do the work, then record the result</strong>
              <p>{interaction.contract?.requestedOutcome}</p>
            </div>
            {data.hostedThreads.some((thread) => thread.interactionId === interactionId) ? (
              <button type="button" className="secondary" onClick={() => navigate('conversations')}>
                Open conversation
              </button>
            ) : null}
          </div>
          <label>
            <span>Outcome</span>
            <select
              value={completionForm.outcome}
              onChange={(event) =>
                setCompletionForm((current) => ({
                  ...current,
                  outcome: event.target.value as typeof current.outcome,
                }))
              }
            >
              <option value="success">Success</option>
              <option value="partial">Partial</option>
              <option value="failure">Failure</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="fullWidth">
            <span>What happened?</span>
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={completionForm.summary}
              onChange={(event) =>
                setCompletionForm((current) => ({ ...current, summary: event.target.value }))
              }
              placeholder="Summarize the delivered result and any material limitations."
            />
          </label>
          <label className="fullWidth">
            <span>Evidence URLs (optional, comma-separated)</span>
            <input
              value={completionForm.evidenceReferences}
              onChange={(event) =>
                setCompletionForm((current) => ({
                  ...current,
                  evidenceReferences: event.target.value,
                }))
              }
              placeholder="https://…"
            />
          </label>
          <button className="primary" type="submit" disabled={working === 'outcome'}>
            {working === 'outcome' ? 'Recording…' : 'Record outcome'}
          </button>
        </form>
      ) : pendingFeedback ? (
        <form className="firstRunForm" onSubmit={(event) => void submitFeedback(event)}>
          <div className="firstRunStage">
            <span className="firstRunIcon">
              <Check />
            </span>
            <div>
              <strong>One last step: private counterparty feedback</strong>
              <p>
                Structured feedback improves task-specific reliability without storing chat text.
              </p>
            </div>
          </div>
          <label>
            <span>Overall rating</span>
            <select
              value={feedbackForm.rating}
              onChange={(event) =>
                setFeedbackForm((current) => ({
                  ...current,
                  rating: Number(event.target.value),
                }))
              }
            >
              {[5, 4, 3, 2, 1].map((rating) => (
                <option value={rating} key={rating}>
                  {rating} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Work together again?</span>
            <select
              value={feedbackForm.wouldWorkAgain}
              onChange={(event) =>
                setFeedbackForm((current) => ({
                  ...current,
                  wouldWorkAgain: event.target.value as typeof current.wouldWorkAgain,
                }))
              }
            >
              <option value="yes">Yes</option>
              <option value="unsure">Unsure</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="fullWidth">
            <span>Private note (optional)</span>
            <textarea
              maxLength={1000}
              value={feedbackForm.privateComment}
              onChange={(event) =>
                setFeedbackForm((current) => ({
                  ...current,
                  privateComment: event.target.value,
                }))
              }
            />
          </label>
          <button className="primary" type="submit" disabled={working === 'feedback'}>
            {working === 'feedback' ? 'Submitting…' : 'Submit private feedback'}
          </button>
        </form>
      ) : (
        <div className="firstRunWaiting">
          <span className="firstRunIcon complete">
            <Check />
          </span>
          <div>
            <strong>Your outcome is recorded</strong>
            <p>
              Waiting for the counterparty report before OpenClasp finalizes the shared receipt.
            </p>
          </div>
          <button type="button" className="secondary" onClick={() => navigate('history')}>
            View progress
          </button>
        </div>
      )}
    </section>
  );
}
