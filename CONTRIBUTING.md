# Contributing

Use Node.js 24+ and pnpm. Before opening a change, run:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm demo
```

Protocol changes require updated Zod definitions, generated JSON Schemas, tests, and protocol documentation. Never add real conversations, credentials, PII, unsupported truth claims, blockchain dependencies, or LLM authority over deterministic policy.
