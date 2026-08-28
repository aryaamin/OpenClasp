# Architecture

OpenClasp surrounds existing agent transport; it does not carry or rewrite ordinary conversation content.

```text
Requester agent -> requester sidecar -> existing A2A transport -> provider sidecar -> provider agent
                         |                                      |
                  local policy/events                    local policy/events
                         +---- permitted structured records ----+
                                         |
                              OpenClasp local/network API
```

The protocol package owns wire validation and cryptography. The core package is transport-independent and keeps deterministic authorization separate from suggestions. REST, SDK, MCP, sidecar, CLI, and dashboard call the same core behavior. `AuditStore` separates persistence; the MVP supplies memory and SQLite implementations and can later add PostgreSQL without changing policy logic.

Hosted ownership is `Auth0 user → project → agent → MCP installation`. The Auth0 subject isolates the
owner's data, while the OAuth client ID identifies a particular installation. A setup or switch
request remains pending until the owner confirms it in the dashboard. Once approved, MCP tools resolve
the bound agent automatically instead of trusting a caller-supplied agent identifier. Unrelated agents
retain separate project context and behavioural history.

Deterministic failures return `DENY`. Evidence or behavioural uncertainty returns `CHALLENGE`. `ALLOW` remains contextual to task, authority, data, version, and evidence.
