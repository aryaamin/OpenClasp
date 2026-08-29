# Runtime connectors

OpenClasp integrates at the runtime boundary, not the hosting-vendor boundary. AWS, GCP, Azure,
Kubernetes, and a VPS use the same sidecar. Closed agent platforms need one reusable connector per
platform. An agent that already implements the A2A and OpenClasp control contracts needs no adapter.

## Integration paths

| Runtime                          | Integration                     | User action                                               |
| -------------------------------- | ------------------------------- | --------------------------------------------------------- |
| Native A2A application           | `@openclasp/sdk`                | Mount the handler and give the agent token to the process |
| Custom or open-source agent      | OpenClasp runtime sidecar       | Deploy one container beside the agent                     |
| Closed platform such as Botpress | Provider integration            | Install once and paste the agent token                    |
| Temporary Codex/Cursor chat      | MCP + hosted temporary identity | Authenticate MCP; no autonomous inbound runtime           |

The agent token is bound to one OpenClasp identity. It can call MCP and self-register the runtime for
that identity. It cannot register an endpoint for another agent.

## Provider adapter contract

Provider connectors implement `AgentRuntimeAdapter` from `@openclasp/sdk`:

- `prepareSession`: decide whether the provider can accept the signed offer;
- `activateSession`: persist the peer endpoint and scoped session credential;
- `receiveMessage`: deliver an authenticated A2A turn to the provider runtime.

`createAgentRuntimeConnector` handles endpoint verification, OpenClasp control signatures, session
credentials, A2A JSON-RPC validation, and response framing. Provider adapters should not duplicate
that security logic.

## Generic sidecar

Build `Dockerfile.sidecar` and deploy it in the same trust boundary as the agent application. Set:

```text
OPENCLASP_AGENT_TOKEN=oc_at_...
OPENCLASP_RUNTIME_URL=https://agent.example.com/a2a
AGENT_ADAPTER_URL=http://agent:3000
OPENCLASP_SESSION_FILE=/app/data/openclasp-sessions.json
# Optional; defaults to a key derived from the agent token
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
```

The offer endpoint returns `{ "accepted": true }` or `{ "accepted": false }`. Activation must return
2xx only after the application durably created or resumed its conversation. The message endpoint
returns the A2A result. Protect these private hooks with `AGENT_ADAPTER_TOKEN` or private networking.

## Provider rule

A provider connector must register the provider-owned webhook directly as the agent endpoint. A
central OpenClasp proxy is not a persistent-runtime connector because it would put OpenClasp back in
the message path. If a provider cannot expose a webhook or runtime hook, it supports temporary mode
only.
