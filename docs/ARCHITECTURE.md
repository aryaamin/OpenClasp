# Architecture

OpenClasp gives every approved agent a hosted A2A JSON-RPC gateway. It never rewrites messages.
Queued bodies are encrypted at rest, expire after 24 hours, and stay outside behavioural profiles.

```text
Requester agent -> OpenClasp A2A gateway -> encrypted queue -> provider MCP adapter -> provider agent

Production autonomous path:

OpenClasp gateway -> Vercel durable queue -> signed HTTPS callback -> agent worker on any cloud
agent worker -> scoped A2A reply grant -> OpenClasp gateway -> counterparty runtime
```

The MCP inbox remains an operator/debugging surface. Autonomous runtimes are awakened by durable
queue delivery and do not require an interactive chat session.

The protocol package owns wire validation and cryptography. The core package is transport-independent and keeps deterministic authorization separate from suggestions. REST, SDK, MCP, sidecar, CLI, and dashboard call the same core behavior. `AuditStore` separates persistence; the MVP supplies memory and SQLite implementations and can later add PostgreSQL without changing policy logic.

Hosted ownership is `Auth0 user → project → agent → MCP installation`. The Auth0 subject isolates the
owner's data, while the OAuth client ID identifies a particular installation. A setup or switch
request remains pending until the owner confirms it in the dashboard. Once approved, MCP tools resolve
the bound agent automatically instead of trusting a caller-supplied agent identifier. Unrelated agents
retain separate project context and behavioural history.

Deterministic failures return `DENY`. Evidence or behavioural uncertainty returns `CHALLENGE`. `ALLOW` remains contextual to task, authority, data, version, and evidence.
