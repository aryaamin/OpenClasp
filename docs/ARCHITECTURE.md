# Architecture

OpenClasp is primarily the control and assurance plane for direct A2A communication. It provides a
separate, explicit hosted adapter only for temporary chat identities that cannot expose HTTPS.

```text
Agent A -> OpenClasp: contract + session request
OpenClasp -> Agent A and B: signed prepare offers
Agent A and B -> OpenClasp: live session endpoints
OpenClasp -> Agent B: activation + A endpoint + scoped credential
OpenClasp -> Agent A: activation + B endpoint + scoped credential

Agent A <========== direct A2A HTTPS ==========> Agent B
    \                                               /
     +---- signed structured events and hashes ----+
                         |
                    OpenClasp history
```

Both runtimes must answer the prepare offer. The responder is activated first so it is ready before
the initiator begins. A failed or offline runtime prevents activation; conversation messages are not
queued for later delivery.

## Temporary chat mode

```text
Codex/Cursor <-- MCP --> OpenClasp temporary A2A endpoint <-- A2A --> persistent runtime
```

Exactly one participant may be temporary in the MVP. The persistent runtime must be online; it
never receives offline queueing. OpenClasp translates the temporary side between MCP and A2A and
stores that thread encrypted at rest for 30 days. Closing one chat session does not delete the
persistent OpenClasp agent identity or its hosted thread.

Platform-signed session credentials bind the interaction, sender, recipient, and expiry. Each
runtime validates the credential locally using the verification key supplied in its signed
activation. `interactionId` is the durable thread key. The agents own message ordering, model state,
and any internal job queue.

OpenClasp stores the immutable contract, bilateral acceptances, runtime/session metadata, message
hashes, structured claims, evidence references, corrections, terminal outcomes, receipts, and
feedback. These records can update contextual behavioural profiles. Message bodies and private model
reasoning stay with the agents in direct mode. Temporary-hosted message text is excluded from
profiles and network contribution even though it is retained for user-visible thread continuity.

The first terminal report produces a clearly labelled provisional insight immediately. Peer reports
and sealed feedback revise it; a missing peer becomes a final low-confidence unilateral result after
the response window. The learning path is deterministic: attested reports and feedback produce an eligibility decision,
then bounded behavioural observations, a decayed task/version profile, and an attested delta. Each
account learns privately about its counterparty. Both accounts must enable contribution before the
decision is marked for a future shared aggregate. The expiry cron also backfills older conclusions
that do not yet have an eligibility decision.

The protocol package owns wire validation and cryptography. The core package keeps deterministic
authorization separate from suggestions. REST, SDK, MCP, sidecar, CLI, and dashboard call the same
core behaviour. Hosted ownership is `Auth0 user → project → agent → MCP installation`; unrelated
agents retain separate project context and history. Interactive installations authenticate through
OpenClasp OAuth; Auth0 supplies Google/GitHub identity without registering each MCP client as an
Auth0 application. Non-interactive hosted providers can use a hashed, expiring, revocable access
token bound to exactly one existing agent.

Deterministic failures return `DENY`. Evidence or behavioural uncertainty returns `CHALLENGE`.
`ALLOW` remains contextual to task, authority, data, version, and evidence.
