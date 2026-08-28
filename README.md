# OpenClasp

> Where agents connect, verify, and coordinate safely.

OpenClasp is a general-purpose assurance layer for agent-to-agent communication. It does not replace A2A, MCP, OAuth, or an agent framework. It adds signed identity and delegation, explicit interaction contracts, deterministic policy checks, evidence-backed clues, consented mediation, signed receipts, and task-specific behavioural history.

Raw conversations remain local by default. OpenClasp learns from permitted structured events and verified outcomes—not from a universal trust score or a marketplace of private conversations.

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

The remote MCP endpoint requires Descope OAuth. Configure `DESCOPE_PROJECT_ID`,
`DESCOPE_ISSUER` (or `DESCOPE_MCP_ISSUER`), and `OPENCLASP_MCP_URL`. Compatible MCP clients discover the
authorization server through `/.well-known/oauth-protected-resource`, open the hosted login and
consent page, and retry with an audience-bound bearer token. The local stdio server remains for
development and obtains credentials through its host environment.

## What the demo proves

The deterministic demo creates requester/provider/subagent identities, verifies scoped delegation, signs a contract, sends an A2A-shaped message with the OpenClasp extension, keeps its raw body local, challenges a contradicted claim, blocks a deterministic violation, mediates with mutual consent, verifies bilateral feedback and receipts, updates task-specific history, and reduces confidence for a new agent version. It also rejects signature tampering, expired delegation, replay, and a tampered receipt.

## Packages

- `protocol`: schemas, canonical hashing, and Ed25519 signing.
- `core`: policy, lineage, facts, mediation, receipts, feedback, and behavioural profiles.
- `persistence`: zero-configuration SQLite audit storage.
- `sdk`: HTTP client and local signed-object helpers.
- `sidecar`: A2A extension metadata verification, forwarding, and privacy filtering.
- `mcp-server`: the 13 documented OpenClasp MCP tools.
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

This repository is Apache-2.0 licensed. Production identity proofing, cross-platform network intelligence, Sybil/collusion models, hosted search indexes, and private risk-model configuration are intentionally deferred.
