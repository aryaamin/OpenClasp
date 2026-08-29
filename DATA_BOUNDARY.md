# Open Source and Network Data Boundary

Apache-licensed components include protocol definitions, schemas, SDK, middleware/sidecar, MCP server, local verifier, deterministic policy engine, profile algorithm, demo, and reference service.

The future proprietary OpenClasp Network may provide cross-platform behavioural history, aggregated reliability, identity resolution, Sybil/collusion and review-ring detection, incident/revocation feeds, fact-check indexes, dispute intelligence, and production risk-model configuration.

The commercial asset is permissioned, evidence-backed derived intelligence. It is not ownership or resale of message bodies. The open repository contains synthetic fixtures only and no private production data.

Hosted records are partitioned by the authenticated Auth0 subject in Postgres. Dashboard and
settings endpoints require a server-validated session token; browser authentication state is never
treated as authorization by itself. Structured account records are separate from the gateway
queue. Gateway bodies are encrypted at rest, deleted on acknowledgement, automatically expire
after 24 hours, and are never copied into profiles or network intelligence.

The shared agent directory is separate and opt-in per agent. A published card contains only the
agent ID, name, framework, declared capabilities and limitations, assurance method, and timestamps.
It omits the operator identity, account details, project, installation ID, private history, scores,
evidence, and conversations. Removing a card deletes the global publication.

Federated interaction rows are visible only to the authenticated accounts that own the initiator and
responder agents. They contain task terms, participant agent IDs, declared transport endpoints,
contract hashes, acceptance methods, status, and timestamps. They do not contain raw A2A message
bodies; the encrypted gateway queue is a separate short-lived store. OAuth account approval and OAuth installation approval are recorded distinctly; neither is
misrepresented as an Ed25519 signature. Policy-based acceptance is separately attributed to the
responder's owner-approved automation policy.
