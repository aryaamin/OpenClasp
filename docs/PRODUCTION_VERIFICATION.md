# Production verification

Run this gate before every production release:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm demo
corepack pnpm --dir connectors/botpress check:type
corepack pnpm --dir connectors/botpress build
```

The CLI demo must prove recipient-bound counterparty context, scoped delegation, an immutable
bilateral contract, A2A extension forwarding, structured-only filtering, contradiction advice,
deterministic scope denial, mutual mediation, completion receipts, sealed bilateral feedback,
attested conclusions, evidence-weighted learning, bilateral network consent, history decay, version
confidence reduction, unilateral adoption, and rejection of tampering, expiry, replay, and invalid
signatures.

## Browser gate

Verify `/history` and `/insights` with representative pending, active, completed, conflicting, and
ineligible records. Check dark and light themes at desktop and 390px widths. Required results:

- no blank page, framework error overlay, console error, or horizontal overflow;
- an interaction reads as contract → private brief → acceptance → session → reports → feedback →
  conclusion → receipt → learning;
- private feedback comments and raw direct-A2A messages never render;
- WCAG 2 A/AA automated audit reports zero violations.

## Production HTTP smoke

```bash
curl --fail https://openclasp.vercel.app/health
curl --fail https://openclasp.vercel.app/.well-known/oauth-protected-resource/mcp
curl --fail https://openclasp.vercel.app/.well-known/oauth-authorization-server
curl -i https://openclasp.vercel.app/mcp
curl -i https://openclasp.vercel.app/v0.1/dashboard
curl -i https://openclasp.vercel.app/api/cron-feedback
```

Expected: health and discovery return `200`; unauthenticated MCP, dashboard, and cron requests return
`401`. The MCP response must advertise the Auth0 resource metadata. Do not export `CRON_SECRET` to
run a manual cron: Vercel invokes the configured schedule with the sensitive secret.

## Runtime scenarios

Test both supported paths with separate accounts:

1. persistent ↔ persistent: both endpoints verified and online; message bodies go directly between
   runtimes;
2. temporary ↔ persistent: the temporary side uses the explicit hosted adapter and encrypted
   history;
3. stop a persistent runtime: OpenClasp must refuse session activation rather than silently relay;
4. submit one completion report: a provisional insight and receipt appear immediately, identify the
   missing reporter, and both agents receive feedback requests;
5. submit both responses or let the configured feedback window expire: the conclusion becomes final

The sealed-feedback window is two hours by default. Set
`OPENCLASP_FEEDBACK_WINDOW_MINUTES` to a value from 15 to 1440 to change it.
and the eligibility decision and private contextual profile delta appear; 6. publish a new agent version: old-version history appears only as reduced-confidence context.

Temporary ↔ temporary is intentionally unsupported in v0.1. Publishing the provider connector to
Botpress Hub and building the sidecar image require the respective provider login and a usable
Docker daemon; source compilation and connector bundling remain part of the automated gate.

## Required production configuration

- Auth0: Google and GitHub connections, API audience, `mcp:access`, and the exact production
  `/sso-callback` URL on the existing SPA application; Auth0 DCR is not used;
- Vercel: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, `OPENCLASP_PUBLIC_URL`,
  `OPENCLASP_MCP_URL`, `DATABASE_URL`, `OPENCLASP_RELAY_ENCRYPTION_KEY`, and sensitive `CRON_SECRET`;
- Vercel Cron: `0 0 * * *` for `/api/cron-feedback`;
- generic sidecar deployments: stable `OPENCLASP_SESSION_SECRET` and the connector variables in
  [`CONNECTORS.md`](CONNECTORS.md);
- Node.js: pinned to the 24.x LTS major.

Never print or commit production secrets, Auth0 client secrets, agent access tokens, session grants,
temporary-message plaintext, or private feedback comments.
