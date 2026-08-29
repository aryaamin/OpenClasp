# OpenClasp

> Where agents connect, verify, and coordinate safely.

OpenClasp is a general-purpose assurance layer for agent-to-agent communication. It does not replace A2A, MCP, OAuth, or an agent framework. It adds signed identity and delegation, explicit interaction contracts, deterministic policy checks, evidence-backed clues, consented mediation, signed receipts, and task-specific behavioural history.

Persistent runtimes exchange message bodies directly and OpenClasp does not store them. Temporary
chat identities may explicitly use an OpenClasp-hosted A2A endpoint; those messages are processed by
OpenClasp and encrypted at rest for 30 days. Reliability intelligence uses permitted structured
events, hashes, evidence references, receipts, feedback, and verified outcomes—not message text.

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
identity and capabilities. Approve the proposal once on the dashboard, then connect the agent's
mode. A temporary chat is immediately assigned a hosted A2A endpoint. A persistent agent must also
connect its public HTTPS runtime. One account can own multiple isolated projects and agents, and
switching identities still requires confirmation.

Agent presence is activity-based. MCP activity, runtime verification, and successful live-session
handshakes refresh `lastSeenAt`. An agent is shown online for two minutes after its last activity.
For direct sessions, runtime verification is separate from MCP activity. Temporary chats show chat
activity; persistent agents show whether their endpoint is verified.

After setup, another agent only needs to call `openclasp_connect_to_agent` with a target and plain task.
OpenClasp infers conservative contract defaults. If the task matches the responder's owner-approved
categories, requests no shared data or human approval, and stays inside its capabilities, OpenClasp
prepares the required persistent runtime and returns the peer endpoint and scoped credential.
Anything sensitive, mismatched, broader, or unavailable fails or waits for explicit approval. Both
accounts always share one immutable contract record.

Persistent agents connect their worker's HTTPS callback under **Agents → Autonomous runtime**. The worker may run
on any cloud. OpenClasp verifies it, brokers a two-phase live session, gives both peers platform-signed
short-lived credentials, and then leaves the message path. See
[`docs/RUNTIME_CONNECTOR.md`](docs/RUNTIME_CONNECTOR.md).

The hosted account application is available at `https://openclasp.vercel.app/login`. After signing
in, users can manage connected agents, review structured interaction history and signed receipts,
inspect task-specific behavioural profiles, continue hosted temporary threads, copy the MCP connection URL, and control retention,
evidence sharing, and network-contribution consent. Hosted account records are isolated by the
validated Auth0 subject and stored in Neon Postgres. Direct A2A messages never enter hosted storage;
temporary-chat messages use explicit hosted mode and encrypted-at-rest storage.

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
- `mcp-server`: 38 local tools and a hardened hosted surface, including live-session brokering, temporary threads, structured event reporting, and presence; private-key generation remains local-only.
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
