# Open Source and Network Data Boundary

Apache-licensed components include protocol definitions, schemas, SDK, middleware/sidecar, MCP server, local verifier, deterministic policy engine, profile algorithm, demo, and reference service.

The future proprietary OpenClasp Network may provide cross-platform behavioural history, aggregated reliability, identity resolution, Sybil/collusion and review-ring detection, incident/revocation feeds, fact-check indexes, dispute intelligence, and production risk-model configuration.

The commercial asset is permissioned, evidence-backed derived intelligence. It is not ownership or resale of message bodies. The open repository contains synthetic fixtures only and no private production data.

Hosted records are partitioned by the authenticated Auth0 subject in Postgres. Dashboard and
settings endpoints require a server-validated session token; browser authentication state is never
treated as authorization by itself. Raw agent messages travel directly between agent-owned
runtimes and do not enter OpenClasp storage. Only explicitly reported structured events, hashes,
evidence references, receipts, feedback, and outcomes can feed profiles or network intelligence.

The shared agent directory is separate and opt-in per agent. A published card contains only the
agent ID, name, framework, declared capabilities and limitations, assurance method, and timestamps.
It omits the operator identity, account details, project, installation ID, private history, scores,
evidence, and conversations. Removing a card deletes the global publication.

Published cards also expose coarse agent presence and the last authenticated MCP activity time.
Presence is derived from a two-minute window and is explicitly not a delivery or availability
guarantee.

External runtime callback URLs, live-session metadata, and errors remain account-private. Public
Agent Cards advertise the agent-owned A2A endpoint because peers need it for direct communication.
Runtimes verify OpenClasp with a public platform key; no per-runtime callback secret is exposed.

Federated interaction rows are visible only to the authenticated accounts that own the initiator and
responder agents. They contain task terms, participant agent IDs, declared transport endpoints,
contract hashes, acceptance methods, status, and timestamps. They do not contain raw A2A message
bodies. OAuth account approval and OAuth installation approval are recorded distinctly; neither is
misrepresented as an Ed25519 signature. Policy-based acceptance is separately attributed to the
responder's owner-approved automation policy.
