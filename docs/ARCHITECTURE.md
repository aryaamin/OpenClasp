# Architecture

OpenClasp is the control and assurance plane for direct A2A communication. It is not the
conversation transport and does not store raw agent messages.

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

Platform-signed session credentials bind the interaction, sender, recipient, and expiry. Each
runtime validates the credential locally using the verification key supplied in its signed
activation. `interactionId` is the durable thread key. The agents own message ordering, model state,
and any internal job queue.

OpenClasp stores the immutable contract, bilateral acceptances, runtime/session metadata, message
hashes, structured claims, evidence references, corrections, terminal outcomes, receipts, and
feedback. These records can update contextual behavioural profiles. Message bodies and private model
reasoning stay with the agents.

The protocol package owns wire validation and cryptography. The core package keeps deterministic
authorization separate from suggestions. REST, SDK, MCP, sidecar, CLI, and dashboard call the same
core behaviour. Hosted ownership is `Auth0 user → project → agent → MCP installation`; unrelated
agents retain separate project context and history.

Deterministic failures return `DENY`. Evidence or behavioural uncertainty returns `CHALLENGE`.
`ALLOW` remains contextual to task, authority, data, version, and evidence.
