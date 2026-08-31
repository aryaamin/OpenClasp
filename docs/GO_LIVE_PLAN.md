# OpenClasp product, intelligence, and go-live plan

Status: working product decision for the v0.1 launch.

## Product decision

OpenClasp is the behavioural intelligence and assurance layer for autonomous agent agreements.

The core promise is:

> OpenClasp predicts whether an external agent will successfully complete a specific agreement and
> recommends the safeguards required.

OpenClasp is horizontal. It is not a vertical workflow product, marketplace, identity provider,
agent framework, or observability product. It works across models, frameworks, operators,
protocols, and task categories.

The open protocol establishes identity, terms, evidence provenance, and outcome integrity. The
commercial product compounds permitted structured outcomes into contextual intelligence. Identity,
signatures, contracts, and dashboards are necessary infrastructure; they are not the moat.

## The moat

The defensible asset is a permissioned outcome graph linking:

```text
operator
  -> agent
    -> deployment and version
      -> model configuration
        -> specific agreement
          -> safeguards selected
            -> observed behaviour
              -> verified evidence
                -> outcome
```

This graph supports four compounding advantages:

1. **Data:** comparable, structured, provenance-bound outcomes that cannot be reconstructed from
   public model benchmarks or private traces.
2. **Models:** calibrated task-specific outcome and risk predictions based on real agreements.
3. **Workflow:** integrations that make contracts, evidence, outcomes, and safeguards part of agent
   execution rather than an after-the-fact review.
4. **Trust:** privacy boundaries, auditability, neutrality, manipulation resistance, and enterprise
   controls that take time to establish.

The open-source protocol and SDK are distribution. Proprietary network intelligence, fraud models,
calibration data, risk configuration, and permissioned aggregates are the commercial layer.

## What OpenClasp learns

OpenClasp must keep these levels separate. An interaction cannot be attributed to a foundation
model when prompts, tools, runtime configuration, or operator behaviour may have caused the result.

| Level       | Examples                                                         | Valid use                                 |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------- |
| Model       | provider, model ID, provider version or alias                    | A prior for broad behavioural tendencies  |
| Deployment  | prompt/config fingerprint, toolset, memory mode, runtime version | Detect material configuration changes     |
| Agent       | stable identity, declared capabilities, agent version            | Agent-specific history and prediction     |
| Operator    | assurance and oversight history                                  | Accountability and manipulation detection |
| Agreement   | task, complexity, permissions, data, deadline, success criteria  | Primary context for a prediction          |
| Interaction | safeguards, checkpoints, evidence, usage, outcome                | Training example and audit record         |

Over time this can answer:

- How likely is this agent deployment to complete this agreement?
- Which criteria or constraints are most at risk?
- Is the available evidence sufficient and trustworthy?
- Did an agent, deployment, or model change alter observed behaviour?
- Which safeguards improved comparable outcomes?
- Should authority be reduced, expanded, or made conditional on approval?

Model- and operator-level results must use minimum cohort sizes, confidence labels, and privacy
controls. OpenClasp must never publish a universal trust score.

## The intelligence product

The long-term decision response should look like this:

```text
Predicted completion: 76%
Confidence: medium; 43 comparable eligible outcomes
Primary risks: scope expansion and weak evidence
Recommended safeguards: restrict write authority, require an intermediate evidence checkpoint,
and obtain approval before external actions
Predicted completion with safeguards: 89%
```

This requires five intelligence components:

1. **Agreement compiler:** converts a plain-language task into a typed task category, measurable
   success criteria, evidence requirements, permissions, deadlines, and approval points.
2. **Evidence verifier:** classifies evidence, validates provenance and integrity, records verifier
   results, and identifies missing support. A hash proves integrity, not truth.
3. **Contextual risk model:** predicts criterion-level and overall outcomes using the agreement,
   agent deployment, relevant history, safeguards, and evidence quality.
4. **Safeguard recommender:** recommends the smallest controls likely to reduce risk and records
   whether each recommendation was accepted.
5. **Manipulation detector:** detects coordinated feedback, repeated counterparties, identity or
   version resets, implausible evidence, burst behaviour, and review rings.

LLMs may compile agreements, classify evidence, and explain recommendations. They do not authorize
actions. Deterministic policy remains responsible for hard `DENY` decisions. An uncertain model
produces `CHALLENGE`, reduced authority, an evidence request, or human review.

OpenClasp must not claim a predictive percentage until it can report an evaluated, calibrated model
and its sample boundary. Before then, the MVP returns deterministic risk decisions, contextual
history, confidence, and clearly labelled recommendations.

## Day-one data rule

Store the right data from day one, not all data.

Raw conversations, private reasoning, secrets, and unrelated personal data create liability and are
not the moat. The valuable record is the structured chain from agreement to verified outcome.

Every retained fact must have:

- a stable ID and the IDs of the entities it concerns;
- an explicit schema name and schema version;
- the event time and server ingestion time in UTC;
- provenance: who or what reported it and by which authenticated method;
- integrity information: canonical hash and attestation where applicable;
- visibility and retention classification;
- collection-time learning eligibility and consent scope;
- `unknown` when a value was not observed; never a guessed default or a false zero.

Source facts are append-only. Corrections create a new record that references the superseded record.
Derived profiles, summaries, predictions, and recommendations are reproducible projections, not
source facts. Training data is built from immutable eligible source records, never scraped from the
current dashboard state.

## Minimum production data model

The existing schemas already cover agent identities, contracts and revisions, live-session events,
completion reports, bilateral feedback, conclusions, receipts, learning eligibility, and profile
deltas. Preserve them. Add the following before relying on production data for future models.

### 1. Agent deployment snapshot

Create a new immutable snapshot whenever a material agent configuration changes.

Required fields:

- `deploymentId`, `agentId`, `agentVersion`, `effectiveFrom`, and optional `effectiveTo`;
- model provider, model ID, model version/alias, and provenance of those claims;
- framework and runtime versions;
- prompt/configuration fingerprint, toolset fingerprint, memory-mode label, and policy fingerprint;
- declared capabilities and limitations;
- material-change reason and operator attestation.

Do not store raw system prompts, credentials, or tool configuration secrets by default. Store stable
fingerprints and permitted non-secret descriptors. If the provider hides an exact model version,
record the alias as self-declared rather than inventing precision.

### 2. Versioned task taxonomy

Free-text `taskCategory` values will fragment the dataset. Introduce:

- a stable hierarchical category ID and taxonomy version;
- task complexity and risk tier;
- modality, expected duration, autonomy level, and consequence class;
- typed success-criterion IDs alongside their human-readable text.

Keep original text. Store AI classifications separately with classifier version and confidence so
they can be recomputed later.

### 3. Safeguard decision

For every agreement, retain:

- safeguards considered and the reason for each;
- source: deterministic rule, model recommendation, participant request, or operator policy;
- recommendation/model version and feature-snapshot hash;
- accepted, rejected, or modified status and actor;
- the final safeguard set actually enforced.

Without this record, OpenClasp cannot learn which safeguards correlate with better outcomes.

### 4. Evidence record and verification

Do not model evidence as URLs alone. Store an evidence record with:

- evidence ID, type, subject, issuer, collector, creation time, and permitted reference;
- content digest, media type, size, and storage boundary;
- provenance and authentication method;
- verification status, verifier, verifier version, checks performed, checked time, and reason codes;
- which contract criterion or claim it supports or contradicts;
- retention and learning eligibility.

Evidence content should remain at its source unless hosted retention is explicitly required. A
digest and successful fetch do not establish truth; verification status must say exactly what was
checked.

### 5. Pre-interaction decision snapshot

Every `ALLOW`, `CHALLENGE`, or `DENY` must be retained before the outcome is known:

- agreement and contract hash;
- decision, reasons, required challenges, confidence, and applicable policy version;
- relevant-history boundary and feature-snapshot hash;
- prediction/recommender version when AI is introduced;
- any predicted outcome probabilities and uncertainty;
- safeguards recommended and eventually applied.

This prevents hindsight leakage and makes later model evaluation honest.

### 6. Normalized usage and intervention metrics

Capture only values reported or observed with clear provenance:

- start, completion, and deadline timestamps;
- model request count and input/output token counts when exposed;
- tool calls, retries, failed calls, and delegations;
- wall-clock duration, checkpoint count, and time blocked;
- human approvals, interventions, takeovers, and escalation reason codes;
- provider-reported or operator-reported cost and currency;
- correction count, scope-change count, and dispute state.

Usage is context, not quality. Higher token or tool usage is not automatically better or worse.

### 7. Outcome label history

An outcome needs more than `success`, `partial`, or `failure`:

- criterion-level result and explicit failure reason codes;
- reporter, verifier, corroboration status, and evidence IDs;
- provisional/final state and confidence;
- label version and superseded label reference;
- late dispute, appeal, correction, or reversal events.

Never overwrite a historical label. Recompute derived profiles after an accepted correction.

### 8. Consent and data-governance ledger

Retain append-only records for:

- participant visibility and evidence-sharing decisions;
- local-learning and network-contribution eligibility at collection time;
- policy/privacy notice version accepted;
- retention expiry, deletion request, export request, and resulting action;
- reason a record was included in or excluded from a training snapshot.

Revocation stops future use as defined by policy. Deletion and aggregate limitations must match the
published privacy terms and applicable law.

### 9. Dataset and model lineage

When predictive models exist, record:

- immutable dataset snapshot ID and inclusion query/version;
- feature definitions and taxonomy versions;
- training code and model version;
- evaluation window, cohort, calibration results, and known limitations;
- deployment time, rollback time, and every prediction made by that version.

Never train directly from production tables without a versioned eligibility and snapshot step.

## Current implementation assessment

The v0.1 lifecycle is substantial and should be kept:

- immutable contract hashes and revision history;
- participant-bound interactions and direct A2A sessions;
- structured checkpoints and evidence references;
- attested completion reports, feedback, conclusions, receipts, and profile deltas;
- version-aware, task-specific profiles with decay;
- local versus network learning eligibility;
- encrypted temporary messages kept outside behavioural intelligence.

The current hosted persistence has production-data weaknesses:

1. `openclasp_records` is a generic JSONB table whose `upsert` mutates source records in place.
2. Most records do not carry an explicit stored schema version independent of protocol version.
3. Agent profiles do not identify the model or immutable deployment configuration.
4. Task categories and criteria are free text without a versioned taxonomy.
5. Evidence references lack a first-class verification record.
6. Safeguard recommendations and their adoption are not captured as a learning loop.
7. There is no pre-outcome prediction/decision snapshot suitable for calibration.
8. Usage, human intervention, cost, and failure reason codes are not normalized.
9. Consent exists, but there is not yet a complete governance ledger or dataset-lineage layer.
10. Schema creation occurs at application startup rather than through explicit versioned migrations.

These do not block a private demonstration. Items 1 through 6 must be fixed before treating real
production interactions as clean future training data.

## MVP launch boundary

### What v0.1 sells

- Verified agent and operator-linked identity.
- Explicit, hash-bound agreement terms.
- Deterministic preflight policy and contextual counterparty history.
- Direct A2A coordination with structured checkpoints.
- Evidence-linked, attested outcomes and receipts.
- Private, task- and version-specific behavioural history.
- Safeguard recommendations labelled as rules or low-confidence assistance.

### What v0.1 does not claim

- A statistically calibrated probability of success.
- Objective truth from unverified evidence or participant ratings.
- A universal agent, model, or operator score.
- Complete model attribution when deployment details are unknown.
- Network-wide intelligence before sufficient consented outcomes exist.
- Autonomous AI authority over policy or permissions.

The honest launch language is **assurance and contextual reliability**. “Prediction” becomes a
product claim only after prospective predictions have been stored and evaluated against later
verified outcomes.

## Go-live gates

### P0: before accepting production interactions

- [ ] Freeze the positioning and MVP claims in this document.
- [x] Enforce separate `profile:read`, `interaction:write`, `feedback:write`, `agent:manage`, and
      owner-only `network:contribute` permission boundaries. Integration credentials cannot enable
      network contribution.
- [x] Add application rate limits, explicit payload limits, strict origin checks, internal identity
      boundary checks, and security headers to hosted write surfaces.
- [ ] Review staged firewall logs, test enforcement on preview, then enable production limits and
      alerting.
- [x] Move platform signing and encryption keys to managed production key storage with documented
      rotation and recovery. Do not silently invalidate old attestations during rotation.
- [x] Disable fixture fact checking in production; return unavailable/unknown until a production
      evidence provider is configured.
- [x] Replace startup DDL with explicit, numbered database migrations.
- [x] Add an append-only source-event journal beside mutable operational projections. Each distinct
      hosted-record snapshot written through the repository is retained rather than overwritten.
- [x] Journal federated-interaction revisions, structured live-session events, and privacy-filtered
      live-session state transitions for both participants.
- [ ] Route remaining direct projection mutations through the source journal and record explicit
      tombstones for governed deletions.
- [x] Add `schemaName`, `schemaVersion`, `ingestedAt`, `reportedAt`, `provenance`, `visibility`,
      `retentionClass`, learning scope, entity references, and a canonical digest to retained source
      records.
- [ ] Add immutable agent deployment snapshots, including model provenance and configuration
      fingerprints.
- [ ] Freeze a small versioned task taxonomy; retain original task text and classification metadata.
- [ ] Add first-class safeguard decisions and evidence-verification records.
- [ ] Record every pre-interaction risk decision before activation.
- [ ] Define normalized failure, intervention, and evidence-verification reason codes.
- [ ] Verify account isolation for every new table and query.
- [ ] Implement and test retention deletion for expired temporary messages and retained source data.
- [ ] Implement user export/deletion workflows and an auditable consent ledger.
- [ ] Configure managed database backups and test a restore.
- [ ] Configure production monitoring and alerts for authentication failures, persistence failures,
      cron failures, outcome-finalization backlog, and runtime-session failures.
- [ ] Separate production and test data; never let demo fixtures enter production aggregates.
- [ ] Run every gate in `docs/PRODUCTION_VERIFICATION.md` against production configuration.
- [ ] Perform an external security review of authentication, authorization, tenant isolation,
      callback SSRF protection, encryption, and signing-key management.
- [ ] Publish privacy terms, data processing terms, retention behaviour, security contact, and an
      incident-response process.

### P1: first four weeks after launch

- [x] Add a guided first-run path that creates a hosted temporary identity, publishes its Agent
      Card, compiles a plain-language task into a bounded agreement, and collects an owner-attested
      outcome plus structured private feedback.
- [ ] Onboard a small number of design partners manually.
- [ ] Review every completed interaction for schema completeness and label quality.
- [ ] Ship the agreement compiler in suggestion-only mode with human/agent confirmation.
- [ ] Ship evidence verification adapters without storing evidence bodies by default.
- [ ] Add a data-quality dashboard: missing fields, unknowns, invalid taxonomies, uncorroborated
      outcomes, consent status, and finalization lag.
- [ ] Add structured outcome appeals and correction propagation.
- [ ] Establish minimum cohort and suppression rules for any aggregate insight.
- [ ] Create the first immutable eligible dataset snapshot and audit it manually.

### P2: after enough eligible outcomes exist

- [ ] Train simple interpretable baselines before complex models.
- [ ] Evaluate prospectively using Brier score, calibration error, false-allow rate, coverage, and
      results by task/risk cohort.
- [ ] Compare predictions against the deterministic and no-history baselines.
- [ ] Release criterion-level risk predictions only where calibration is acceptable.
- [ ] Test safeguard recommendations as measured interventions; do not call correlation causal.
- [ ] Add graph-based Sybil, collusion, and review-ring detection.
- [ ] Introduce model-, deployment-, agent-, and operator-level aggregates with privacy thresholds.

## Launch operating plan

Launch as a controlled production beta, not an unrestricted network.

The landing page, local demo, and booked demonstrations can go live immediately. Real external
interactions should remain invite-only until the P0 controls pass. Public self-service should wait
until the controlled beta has proven isolation, retention, restore, and a complete outcome cycle.

1. Keep accounts free during the controlled beta and monitor public-login abuse and activation.
2. Require each partner to bring a real counterparty; temporary-to-temporary interactions remain
   unsupported.
3. Use the guided first run to define one measurable agreement and evidence plan.
4. Observe the first interaction end to end: contract, decision, session, outcome, feedback,
   conclusion, receipt, eligibility, and profile delta.
5. Audit the retained records before allowing the next interaction.
6. Conduct a weekly label and taxonomy review; version changes instead of silently editing history.
7. Expand only after tenant isolation, deletion, restore, and finalization have worked in production.

The first launch objective is not registered agents. It is a small set of complete, consented,
high-quality agreement-to-outcome records.

## Product metrics

The primary metric is:

> Eligible, verified outcomes that can improve a future contextual decision.

Track:

- time to first protected interaction;
- agreement activation and completion rate;
- percentage of criteria that are objectively verifiable;
- bilateral/corroborated outcome rate;
- outcome finalization lag;
- evidence verification success and unknown rate;
- safeguard recommendation acceptance and modification rate;
- dispute, correction, and human-intervention rate;
- repeat protected interactions between active accounts;
- eligible local and network-contribution outcome counts;
- data completeness and invalid-record rate;
- once predictive models ship: calibration, Brier score, false-allow rate, and abstention coverage.

Do not optimize for registrations, public directory size, raw event volume, or a high average trust
score.

## Immediate implementation order

1. Add the deployment snapshot, task taxonomy, safeguard decision, evidence verification, and
   pre-interaction decision schemas.
2. Thread those IDs through contracts, sessions, reports, conclusions, and profile deltas.
3. Add activation analytics for first agent, first agreement, first outcome, and first eligible
   record without collecting raw task or conversation text.
4. Add retention, export/deletion, consent ledger, backup/restore, and data-quality tests.
5. Run the production verification and external security gates.
6. Onboard the first controlled beta account and inspect the full retained record manually.

Do not build a predictive model first. Clean prospective decisions and verified outcomes are the
prerequisite for a defensible model.
