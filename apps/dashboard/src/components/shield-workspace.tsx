import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, BrainCircuit, CheckCircle2, Plus, ShieldAlert } from 'lucide-react';

type RecordValue = Record<string, any>;

export function ShieldWorkspace({
  agents,
  cases,
  consultations,
  outcomes,
  api,
  refreshDashboard,
}: {
  agents: RecordValue[];
  cases: RecordValue[];
  consultations: RecordValue[];
  outcomes: RecordValue[];
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  refreshDashboard: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(() => String(cases[0]?.caseId ?? ''));
  const [creating, setCreating] = useState(cases.length === 0);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [agentId, setAgentId] = useState(() => String(agents[0]?.agentId ?? ''));
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [action, setAction] = useState('');
  const [brief, setBrief] = useState('');
  const [policies, setPolicies] = useState('');
  const [counterpartyType, setCounterpartyType] = useState('human');
  const [message, setMessage] = useState('');
  const [guidance, setGuidance] = useState('');
  const [outcomeResult, setOutcomeResult] = useState('successful');
  const [acceptedAdvice, setAcceptedAdvice] = useState(true);
  const [actionTaken, setActionTaken] = useState('');
  const [testToken, setTestToken] = useState<RecordValue>();

  useEffect(() => {
    if (!selectedId && cases[0]?.caseId) setSelectedId(String(cases[0].caseId));
  }, [cases, selectedId]);

  const selected = cases.find((item) => String(item.caseId) === selectedId);
  const caseConsultations = useMemo(
    () =>
      consultations
        .filter((item) => String(item.caseId) === selectedId)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    [consultations, selectedId],
  );
  const caseOutcome = outcomes.find((item) => String(item.caseId) === selectedId);

  const createCase = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentId) return;
    setWorking('create');
    setError('');
    try {
      const result = (await api('/v0.1/shield/cases', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          title,
          goal,
          brief,
          ...(action ? { proposedAction: action } : {}),
          counterparty: { type: counterpartyType },
          policies: policies
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((statement, index) => ({ title: `Policy ${index + 1}`, statement })),
          facts: [],
          evidence: [],
        }),
      })) as RecordValue;
      setSelectedId(String(result.caseId));
      setCreating(false);
      setTitle('');
      setGoal('');
      setAction('');
      setBrief('');
      setPolicies('');
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open Shield case');
    } finally {
      setWorking('');
    }
  };

  const consult = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !message.trim()) return;
    setWorking('consult');
    setError('');
    try {
      await api(`/v0.1/shield/cases/${encodeURIComponent(selectedId)}/consult`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          situationContext: '',
          facts: [],
          evidence: [],
          policies: [],
        }),
      });
      setMessage('');
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Shield consultation failed');
    } finally {
      setWorking('');
    }
  };

  const addGuidance = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !guidance.trim()) return;
    setWorking('guidance');
    setError('');
    try {
      await api(`/v0.1/shield/cases/${encodeURIComponent(selectedId)}/guidance`, {
        method: 'POST',
        body: JSON.stringify({ instruction: guidance, scope: 'case' }),
      });
      setGuidance('');
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save owner guidance');
    } finally {
      setWorking('');
    }
  };

  const closeCase = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !actionTaken.trim()) return;
    setWorking('close');
    setError('');
    try {
      await api(`/v0.1/shield/cases/${encodeURIComponent(selectedId)}/close`, {
        method: 'POST',
        body: JSON.stringify({
          result: outcomeResult,
          acceptedAdvice,
          actionTaken,
        }),
      });
      setActionTaken('');
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not close Shield case');
    } finally {
      setWorking('');
    }
  };

  const createTestToken = async () => {
    if (!agentId) return;
    setWorking('token');
    setError('');
    try {
      const result = (await api(`/v0.1/agents/${encodeURIComponent(agentId)}/shield-tokens`, {
        method: 'POST',
        body: JSON.stringify({ name: 'τ³ benchmark', expiresInDays: 7 }),
      })) as RecordValue;
      setTestToken(result);
      await refreshDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create benchmark token');
    } finally {
      setWorking('');
    }
  };

  return (
    <div className="shieldPage">
      <header className="shieldHero">
        <div>
          <span className="eyebrow">OPENCLASP SHIELD · EXPERIMENTAL</span>
          <h1>An independent AI beside your agent.</h1>
          <p>
            Investigate persuasion, unsupported claims, policy conflicts and risky decisions before
            your agent commits or acts.
          </p>
        </div>
        <div className="shieldHeroActions">
          <label>
            Test agent
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {agents.map((agent) => (
                <option value={String(agent.agentId)} key={String(agent.agentId)}>
                  {String(agent.name ?? agent.agentId)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            type="button"
            disabled={!agentId || working === 'token'}
            onClick={() => void createTestToken()}
          >
            {working === 'token' ? 'creating…' : 'create 7-day τ³ token'}
          </button>
          <button className="landingPrimary" type="button" onClick={() => setCreating(true)}>
            <Plus /> new case
          </button>
        </div>
      </header>

      {error ? <div className="errorBar">{error}</div> : null}

      {testToken ? (
        <section className="shieldToken" role="status">
          <div>
            <span className="eyebrow">COPY NOW · SHOWN ONCE</span>
            <strong>τ³ benchmark token for {String(testToken.agentId)}</strong>
            <p>
              Expires {new Date(String(testToken.expiresAt)).toLocaleString()}. It cannot manage the
              account or connect a runtime.
            </p>
          </div>
          <input aria-label="τ³ benchmark token" value={String(testToken.token)} readOnly />
          <button
            className="secondary"
            type="button"
            onClick={() => void navigator.clipboard.writeText(String(testToken.token))}
          >
            copy token
          </button>
          <button className="secondary" type="button" onClick={() => setTestToken(undefined)}>
            dismiss
          </button>
        </section>
      ) : null}

      {creating ? (
        <form className="shieldCreate" onSubmit={createCase}>
          <header>
            <div>
              <span className="eyebrow">NEW DECISION</span>
              <h2>What should Shield help with?</h2>
            </div>
            {cases.length ? (
              <button type="button" onClick={() => setCreating(false)}>
                cancel
              </button>
            ) : null}
          </header>
          <div className="shieldFormGrid">
            <label>
              Protected agent
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
                <option value="">Select an agent</option>
                {agents.map((agent) => (
                  <option value={String(agent.agentId)} key={String(agent.agentId)}>
                    {String(agent.name ?? agent.agentId)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Counterparty
              <select
                value={counterpartyType}
                onChange={(event) => setCounterpartyType(event.target.value)}
              >
                <option value="human">Human</option>
                <option value="agent">AI agent</option>
                <option value="service">Service or tool</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="wide">
              Case title
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label className="wide">
              Goal
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} required />
            </label>
            <label className="wide">
              Proposed action
              <input
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="Issue refund, disclose data, approve transfer…"
              />
            </label>
            <label className="wide">
              Initial situation
              <textarea value={brief} onChange={(event) => setBrief(event.target.value)} />
            </label>
            <label className="wide">
              Relevant policies · one per line
              <textarea value={policies} onChange={(event) => setPolicies(event.target.value)} />
            </label>
          </div>
          <button className="landingPrimary" disabled={working === 'create' || !agents.length}>
            {working === 'create' ? 'opening…' : 'open Shield case'} <ArrowRight />
          </button>
        </form>
      ) : (
        <div className="shieldWorkspace">
          <aside className="shieldCases">
            <span className="eyebrow">CASES</span>
            {cases.map((item) => (
              <button
                type="button"
                key={String(item.caseId)}
                className={selectedId === String(item.caseId) ? 'active' : ''}
                onClick={() => setSelectedId(String(item.caseId))}
              >
                <strong>{String(item.title)}</strong>
                <span>
                  {String(item.status)} · {String(item.riskTier)} risk
                </span>
              </button>
            ))}
          </aside>

          {selected ? (
            <section className="shieldCase">
              <header className="shieldCaseHead">
                <div>
                  <span className="eyebrow">{String(selected.status).toUpperCase()}</span>
                  <h2>{String(selected.title)}</h2>
                  <p>{String(selected.goal)}</p>
                </div>
                <div className={`shieldRisk ${String(selected.riskTier)}`}>
                  <ShieldAlert />
                  <span>{String(selected.riskTier)} risk</span>
                </div>
              </header>

              {selected.ownerGuidance?.length ? (
                <section className="shieldGuidanceList">
                  <span className="eyebrow">OWNER GUIDANCE</span>
                  {selected.ownerGuidance.map((item: RecordValue) => (
                    <p key={String(item.guidanceId)}>{String(item.instruction)}</p>
                  ))}
                </section>
              ) : null}

              <div className="shieldConversation">
                {caseConsultations.length ? (
                  caseConsultations.map((item) => {
                    const analysis = item.analysis as RecordValue;
                    return (
                      <article className="shieldReply" key={String(item.consultationId)}>
                        <header>
                          <span>
                            <BrainCircuit /> Shield
                          </span>
                          <b>{humanize(String(analysis.disposition))}</b>
                        </header>
                        <p>{String(analysis.reply)}</p>
                        {analysis.rationale?.length ? (
                          <ul>
                            {analysis.rationale.map((reason: unknown) => (
                              <li key={String(reason)}>{String(reason)}</li>
                            ))}
                          </ul>
                        ) : null}
                        {analysis.questionsToAsk?.length ? (
                          <div className="shieldQuestions">
                            <strong>Questions to resolve</strong>
                            {analysis.questionsToAsk.map((question: unknown) => (
                              <span key={String(question)}>{String(question)}</span>
                            ))}
                          </div>
                        ) : null}
                        {analysis.claims?.length ? (
                          <div className="shieldAnalysisGrid">
                            <strong>Material claims</strong>
                            {analysis.claims.map((claim: RecordValue, index: number) => (
                              <div key={`${String(claim.claim)}-${index}`}>
                                <span className={`shieldTag ${String(claim.status)}`}>
                                  {humanize(String(claim.status))}
                                </span>
                                <p>{String(claim.claim)}</p>
                                <small>{String(claim.explanation)}</small>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {analysis.manipulationSignals?.length ? (
                          <div className="shieldAnalysisGrid">
                            <strong>Pressure or manipulation signals</strong>
                            {analysis.manipulationSignals.map(
                              (signal: RecordValue, index: number) => (
                                <div key={`${String(signal.tactic)}-${index}`}>
                                  <span className={`shieldTag ${String(signal.significance)}`}>
                                    {humanize(String(signal.tactic))}
                                  </span>
                                  <p>{String(signal.observation)}</p>
                                </div>
                              ),
                            )}
                          </div>
                        ) : null}
                        <div className="shieldActionGrid">
                          {analysis.nextSteps?.length ? (
                            <section>
                              <strong>Do next</strong>
                              <ol>
                                {analysis.nextSteps.map((step: unknown) => (
                                  <li key={String(step)}>{String(step)}</li>
                                ))}
                              </ol>
                            </section>
                          ) : null}
                          {analysis.safeguards?.length ? (
                            <section>
                              <strong>Safeguards</strong>
                              <ul>
                                {analysis.safeguards.map((safeguard: unknown) => (
                                  <li key={String(safeguard)}>{String(safeguard)}</li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                        </div>
                        {analysis.suggestedResponse ? (
                          <blockquote className="shieldSuggestedResponse">
                            <strong>Suggested response</strong>
                            <p>{String(analysis.suggestedResponse)}</p>
                          </blockquote>
                        ) : null}
                        <footer>
                          {String(item.generation?.mode)} · {String(item.generation?.model)}
                        </footer>
                      </article>
                    );
                  })
                ) : (
                  <div className="shieldEmpty">
                    <BrainCircuit />
                    <strong>Tell Shield what is happening.</strong>
                    <p>
                      It will inspect the case, challenge assumptions and propose what to do next.
                    </p>
                  </div>
                )}
              </div>

              {selected.status !== 'closed' ? (
                <>
                  <form className="shieldComposer" onSubmit={consult}>
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Ask Shield what is happening, add new context, or challenge its recommendation…"
                      required
                    />
                    <button className="landingPrimary" disabled={working === 'consult'}>
                      {working === 'consult' ? 'investigating…' : 'consult Shield'} <ArrowRight />
                    </button>
                    <small>
                      Your message is processed transiently; only Shield’s structured assessment is
                      stored.
                    </small>
                  </form>

                  <div className="shieldCaseControls">
                    <form onSubmit={addGuidance}>
                      <span className="eyebrow">INSTRUCT SHIELD</span>
                      <input
                        aria-label="Owner guidance"
                        value={guidance}
                        onChange={(event) => setGuidance(event.target.value)}
                        placeholder="Always verify offline approval notes…"
                        required
                      />
                      <button disabled={working === 'guidance'}>save owner guidance</button>
                    </form>
                    <form onSubmit={closeCase}>
                      <span className="eyebrow">RECORD OUTCOME</span>
                      <div>
                        <select
                          aria-label="Outcome result"
                          value={outcomeResult}
                          onChange={(event) => setOutcomeResult(event.target.value)}
                        >
                          <option value="successful">Successful</option>
                          <option value="prevented_harm">Prevented harm</option>
                          <option value="escalated">Escalated</option>
                          <option value="false_alarm">False alarm</option>
                          <option value="unsuccessful">Unsuccessful</option>
                          <option value="unknown">Unknown</option>
                        </select>
                        <input
                          aria-label="Action ultimately taken"
                          value={actionTaken}
                          onChange={(event) => setActionTaken(event.target.value)}
                          placeholder="What action was ultimately taken?"
                          required
                        />
                      </div>
                      <label className="shieldCheckbox">
                        <input
                          type="checkbox"
                          checked={acceptedAdvice}
                          onChange={(event) => setAcceptedAdvice(event.target.checked)}
                        />
                        Shield's advice materially influenced the action
                      </label>
                      <button disabled={working === 'close'}>close case</button>
                    </form>
                  </div>
                </>
              ) : caseOutcome ? (
                <div className="shieldClosed">
                  <CheckCircle2 />
                  <span>
                    <strong>{humanize(String(caseOutcome.result))}</strong>
                    {String(caseOutcome.actionTaken)}
                  </span>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll('_', ' ');
}
