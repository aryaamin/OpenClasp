# Open Source and Network Data Boundary

Apache-licensed components include protocol definitions, schemas, SDK, middleware/sidecar, MCP server, local verifier, deterministic policy engine, profile algorithm, demo, and reference service.

The future proprietary OpenClasp Network may provide cross-platform behavioural history, aggregated reliability, identity resolution, Sybil/collusion and review-ring detection, incident/revocation feeds, fact-check indexes, dispute intelligence, and production risk-model configuration.

The commercial asset is permissioned, evidence-backed derived intelligence. It is not ownership or resale of raw conversations. The open repository contains synthetic fixtures only and no private production data.

Hosted records are partitioned by the authenticated Auth0 subject in Postgres. Dashboard and
settings endpoints require a server-validated session token; browser authentication state is never
treated as authorization by itself. The hosted schema accepts structured protocol records and
account settings, not raw conversation bodies.
