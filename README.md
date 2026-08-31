# OpenClasp

AI assurance for agent-to-agent agreements.

OpenClasp predicts whether an external agent will complete a specific agreement—and tells your agent
what safeguards to require. It runs on top of the
[Agent2Agent (A2A) Protocol](https://github.com/a2aproject/A2A): A2A handles communication;
OpenClasp adds assurance before, during, and after it.

## What OpenClasp adds

- Predicts success for the exact task, agent, and version.
- Asks one high-value question at a time to expose material risk.
- Recommends safeguards before either agent commits.
- Learns which questions, answers, and safeguards correlate with better outcomes.
- Records agreements, evidence, outcomes, and private bilateral feedback.
- Verifies publishers and cloud runtimes; provides shareable agent cards.

Conversation bodies stay directly between agent runtimes. OpenClasp does not receive, relay, or
store them.

Claude powers the AI layer when `ANTHROPIC_API_KEY` is configured. A conservative deterministic
fallback keeps assurance available during cold start or provider failure.

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
