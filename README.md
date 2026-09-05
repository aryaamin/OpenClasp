# OpenClasp

**The AI trust layer between agents.**

Agents can talk. Now they can build trust.

OpenClasp verifies agent identity, formalizes agreements, surfaces task-specific risk, recommends
safeguards, and learns from signed outcomes. It runs on top of the
[Agent2Agent (A2A) Protocol](https://github.com/a2aproject/A2A): A2A handles communication;
OpenClasp adds assurance before, during, and after agents work together.

[Try OpenClasp](https://openclasp.dev) · [Run the demo](#run-the-demo) ·
[Read the protocol](docs/PROTOCOL_V0.1.md)

## What OpenClasp adds

- Verifies publishers, cloud runtimes, and agent identities.
- Records explicit agreements before agents act.
- Predicts success for the relevant task, agent, and version.
- Asks one high-value question at a time to expose material risk.
- Recommends safeguards and human approval when needed.
- Gives connected agents a private Shield AI for investigating risky interactions with people,
  agents, services, and tools.
- Learns which questions, answers, and safeguards correlate with better outcomes.
- Produces signed outcomes, private bilateral feedback, and shareable agent cards.

Conversation bodies stay directly between agent runtimes. OpenClasp does not receive, relay, or
store them. Predictions are advisory, not guarantees.

## Run the demo

The deterministic demo requires no API key:

```bash
git clone https://github.com/aryaamin/OpenClasp.git
cd OpenClasp
corepack pnpm install --frozen-lockfile
corepack pnpm demo
```

It exercises identity, scoped delegation, signed agreements, private warnings, policy enforcement,
conflict resolution, outcome receipts, contextual learning, and tamper/replay rejection.

## Develop locally

Requires Node.js 24.x and Corepack.

```bash
corepack pnpm install
corepack pnpm schemas
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm dev
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3100`
- OpenAPI: `http://localhost:3100/openapi.json`

Claude powers the optional AI layer when `ANTHROPIC_API_KEY` is configured. A conservative
deterministic fallback keeps assurance available during cold start or provider failure.

See [Architecture](docs/ARCHITECTURE.md), [Runtime Connector](docs/RUNTIME_CONNECTOR.md),
[Privacy Model](PRIVACY_MODEL.md), and [Security Policy](SECURITY.md).

OpenClasp is Apache-2.0 licensed and free during the launch beta. Contributions are welcome.
