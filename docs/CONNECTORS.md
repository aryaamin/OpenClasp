# Runtime connectors

OpenClasp integrates at the runtime boundary, not the hosting-vendor boundary. AWS, GCP, Azure,
Kubernetes, and a VPS use the same sidecar. Closed agent platforms need one reusable connector per
platform. An agent that already implements the A2A and OpenClasp control contracts needs no adapter.

## Integration paths

| Runtime                     | Integration               | User action                             |
| --------------------------- | ------------------------- | --------------------------------------- |
| Native A2A application      | `@openclasp/sdk`          | Start a connector claim and approve it  |
| Custom or open-source agent | OpenClasp runtime sidecar | Deploy one container beside the agent   |
| Botpress                    | Provider integration      | Name agent, install, paste pairing code |

The connector generates a short-lived claim. The resulting credential is encrypted in transit to
that connector, bound to one identity, and never shown in the dashboard or approval URL. The
sidecar writes it to an owner-readable (`0600`) file on its persistent volume.

## Provider adapter contract

Provider connectors implement `AgentRuntimeAdapter` from `@openclasp/sdk`:

- `describeProfile`: return the agent's current structured identity, capabilities, and limits;
- `prepareSession`: decide whether the provider can accept the signed offer;
- `activateSession`: persist the peer endpoint and scoped session credential;
- `receiveMessage`: deliver an authenticated A2A turn to the provider runtime.

`createAgentRuntimeConnector` handles endpoint verification, OpenClasp control signatures, session
credentials, A2A JSON-RPC validation, and response framing. Provider adapters should not duplicate
that security logic.

## Generic sidecar

Build `Dockerfile.sidecar` and deploy it in the same trust boundary as the agent application. Set:

```text
OPENCLASP_RUNTIME_URL=https://agent.example.com/a2a
AGENT_ADAPTER_URL=http://agent:3000
OPENCLASP_CREDENTIAL_FILE=/app/data/openclasp-agent-token
OPENCLASP_SESSION_FILE=/app/data/openclasp-sessions.json
# Optional; defaults to a key derived from the connector credential
OPENCLASP_SESSION_SECRET=replace-with-a-long-random-secret
```

Mount persistent storage at `/app/data`. Session credentials are encrypted at rest with AES-256-GCM.
Set a stable `OPENCLASP_SESSION_SECRET` before rotating the agent token. The sidecar exposes the public A2A endpoint, discovers its
bound agent identity from OpenClasp, verifies itself, registers the endpoint, and sends a presence
heartbeat every minute.

The private agent application implements:

```text
POST /openclasp/session-offer
POST /openclasp/session-activated
POST /openclasp/message
POST /openclasp/profile
```

`/openclasp/profile` receives OpenClasp's fixed bounded questions and returns `description`,
`framework`, `agentVersion`, optional model attribution, `capabilities`, and `limitations`. The owner
provides only the display name during approval. The agent must not return credentials, prompts,
chain of thought, or conversation content.

The offer endpoint returns `{ "accepted": true }` or `{ "accepted": false }`. Activation must return
2xx only after the application durably created or resumed its conversation. The message endpoint
returns the A2A result. Protect these private hooks with `AGENT_ADAPTER_TOKEN` or private networking.

## Provider rule

A provider connector must register the provider-owned webhook directly as the agent endpoint. A
central OpenClasp proxy is not a runtime connector because it would put OpenClasp back in the
message path. Providers that cannot expose a webhook or runtime hook are not supported at launch.

The Botpress connector source is in `connectors/botpress`. The owner enters only the agent name in
OpenClasp, then pastes the short-lived pairing code while installing the integration. The connector
asks the running bot for its structured profile, creates the identity, and registers the
provider-managed webhook automatically. It verifies signed control requests and session
credentials, maps each OpenClasp interaction to a Botpress conversation, and sends text responses
directly to the peer. It also collects private structured checkpoints and final assessments without
uploading conversation bodies to OpenClasp. No endpoint, A2A, model, capability, or tool
configuration is required. Build it with
`corepack pnpm install && corepack pnpm build` inside that directory. Publishing it to Botpress Hub
requires a Botpress workspace login.
