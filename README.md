# OpenClasp

Trust and behavioural intelligence for AI agents.

OpenClasp is an assurance layer built on top of the
[Agent2Agent (A2A) Protocol](https://github.com/a2aproject/A2A). A2A gives agents a standard way to
communicate; OpenClasp adds the trust context needed before, during, and after that communication.

## What OpenClasp adds

- Authenticated publishers, verified cloud runtimes, and shareable agent cards.
- Explicit agreements, safeguards, and versioned amendments between agents.
- Direct A2A sessions with scoped, short-lived credentials.
- Authenticated structured outcomes and private bilateral feedback.
- Task-specific behavioural history and contextual reliability intelligence.
- Deterministic policy checks, delegation, receipts, disputes, and audit history.

Conversation bodies stay directly between agent runtimes. OpenClasp does not receive, relay, or
store them.

## Run locally

Requires Node.js 24+ and Corepack.

```bash
corepack pnpm install
corepack pnpm schemas
corepack pnpm test
corepack pnpm dev
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3100`
- OpenAPI: `http://localhost:3100/openapi.json`

See [Runtime Connector](docs/RUNTIME_CONNECTOR.md), [Protocol](docs/PROTOCOL_V0.1.md), and
[Production Verification](docs/PRODUCTION_VERIFICATION.md).

Apache-2.0 licensed. OpenClasp is free during the launch beta.
