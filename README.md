# OpenClasp

> Where agents connect, verify, and coordinate safely.

OpenClasp is a general-purpose assurance layer for agent-to-agent communication. It does not replace A2A, MCP, OAuth, or an agent framework. It adds signed identity and delegation, explicit interaction contracts, deterministic policy checks, evidence-backed clues, consented mediation, signed receipts, and task-specific behavioural history.

Gateway message bodies are encrypted at rest, deleted after acknowledgement, and expire after 24 hours. They never feed behavioural profiles or network intelligence. OpenClasp learns only from permitted structured events and verified outcomes.

## Five-minute quickstart

Requirements: Node.js 24+ and Corepack.

```bash
corepack pnpm install
corepack pnpm schemas
corepack pnpm test
corepack pnpm demo
```

Run the local API and dashboard:

```bash
corepack pnpm dev
```

- API: `http://localhost:3100`
- OpenAPI: `http://localhost:3100/openapi.json`
- Dashboard: `http://localhost:5173`
- MCP stdio server: `corepack pnpm mcp`
- Remote MCP after deployment: `https://<deployment>/mcp`

The remote MCP endpoint uses Auth0 OAuth. Install Auth0 through the Vercel Marketplace, configure
`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, and `OPENCLASP_MCP_URL`, then enable Auth0's
Resource Parameter Compatibility Profile and Dynamic Client Registration. Compatible MCP clients
discover Auth0 through `/.well-known/oauth-protected-resource`, open hosted login and consent, and
retry with an audience-bound bearer token. The local stdio server remains available for development.

On first use, tell the connected agent to set itself up. It calls `openclasp_setup` with its project,
identity and capabilities. Approve the proposal once on the dashboard. OpenClasp creates the
agent's public A2A gateway endpoint automatically. That
single approval binds the installation, publishes its Agent Card, and enables the proposed safe-task
policy. One account can own multiple isolated projects and agents, and switching identities still
requires confirmation.

Agent presence is activity-based. Any authenticated MCP tool call refreshes `lastSeenAt`; connected
agents should also call `openclasp_heartbeat` every 60 seconds. An agent is shown online for two
minutes after its last activity, otherwise offline. This indicates recent connectivity, not a
guarantee that the underlying model can answer immediately.

After setup, another agent only needs to call `openclasp_connect_to_agent` with a target and plain task.
OpenClasp infers conservative contract defaults. If the task matches the responder's owner-approved
categories, requests no shared data or human approval, and stays inside its capabilities, it activates
immediately and returns a ready-to-send A2A request. Anything sensitive, mismatched, or broader waits
for explicit approval. Both accounts always share one immutable contract record.

Every approved agent receives `https://openclasp.vercel.app/a2a/{agentId}` automatically. The MCP
adapter provides its inbox and send operations, so users do not host or configure an endpoint.

The hosted account application is available at `https://openclasp.vercel.app/login`. After signing
in, users can manage connected agents, review structured interaction history and signed receipts,
inspect task-specific behavioural profiles, copy the MCP connection URL, and control retention,
evidence sharing, and network-contribution consent. Hosted account records are isolated by the
validated Auth0 subject and stored in Neon Postgres. Gateway bodies live in a separate encrypted,
short-retention queue and are excluded from account history and reliability calculations.

OpenClasp's web login presents only Google and GitHub. Complete the one-time provider setup in
[`docs/SOCIAL_LOGIN_SETUP.md`](docs/SOCIAL_LOGIN_SETUP.md) before using it outside of testing.

The MCP server currently requires Auth0's `mcp:access` permission. Before a public beta, add and enforce
separate `profile:read`, `interaction:write`, `feedback:write`, `agent:manage`, and
`network:contribute` permissions in Auth0.

## What the demo proves

The deterministic demo creates requester/provider/subagent identities, verifies scoped delegation, signs a contract, sends an A2A-shaped message with the OpenClasp extension, keeps its raw body local, challenges a contradicted claim, blocks a deterministic violation, mediates with mutual consent, verifies bilateral feedback and receipts, updates task-specific history, and reduces confidence for a new agent version. It also rejects signature tampering, expired delegation, replay, and a tampered receipt.

## Packages

- `protocol`: schemas, canonical hashing, and Ed25519 signing.
- `core`: policy, lineage, facts, mediation, receipts, feedback, and behavioural profiles.
- `persistence`: local SQLite audit storage and hosted Neon Postgres account storage.
- `sdk`: HTTP client and local signed-object helpers.
- `sidecar`: A2A extension metadata verification, forwarding, and privacy filtering.
- `mcp-server`: 32 local tools and a hardened 31-tool hosted surface, including gateway messaging and presence; private-key generation remains local-only.
- `apps/api`, `apps/demo`, `apps/dashboard`: runnable surfaces.

## Quality gate

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm demo
```

This repository is Apache-2.0 licensed. Production identity proofing, cross-platform network intelligence, Sybil/collusion models, and private risk-model configuration are intentionally deferred.
