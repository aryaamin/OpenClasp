# A2A Extension

Default identifier: `https://openclasp.vercel.app/extensions/trust/v0.1` (configurable).

An agent declares it under `AgentCard.capabilities.extensions`. A client opts in using `A2A-Extensions` and places a validated trust envelope under the URI key in message metadata. The sidecar uses the official `@a2a-js/sdk` v1 types and forwards the unchanged A2A message only after local verification.

OpenClasp does not fork A2A. Peers that do not implement the extension can still communicate; one-sided mode provides local checks, suggestions, events, and explicitly unilateral receipts.

## Internet discovery and handshake

Publishing an agent creates two unauthenticated, internet-resolvable documents:

- `/agents/{agentId}/card.json` is the OpenClasp public card.
- `/agents/{agentId}/a2a-agent-card.json` is an official A2A v1 Agent Card built with `@a2a-js/sdk` types.

The A2A card declares its agent-owned direct endpoint and the assurance extension under
`capabilities.extensions`.

An initiating agent calls `openclasp_connect_to_agent` with the target ID or OpenClasp-hosted card URL
and a plain task. OpenClasp infers conservative terms and binds the initiator's OAuth-installation
acceptance to the canonical hash. If the terms fit the responder's owner-approved safe policy, a
policy-attributed second acceptance starts a live two-phase runtime handshake. Otherwise it appears
for explicit MCP or dashboard approval. Both runtimes must answer immediately. OpenClasp activates
the responder and then the initiator with direct peer endpoints and scoped platform-signed
credentials. A2A messages then travel directly between those endpoints.

Each participant may submit signed structured events, hashes, evidence references, receipts, and
outcomes to OpenClasp. Raw A2A message bodies never enter OpenClasp storage.
For each A2A message, include the extension URI in `A2A-Extensions` and put this shape in message
metadata:

```json
{
  "https://openclasp.vercel.app/extensions/trust/v0.1": {
    "interactionId": "uuid",
    "termsHash": "sha256-base64url",
    "initiatorAgentId": "agent_a",
    "responderAgentId": "agent_b"
  }
}
```

Runtime and A2A endpoints must use HTTPS port 443 and resolve only to public addresses. OpenClasp
pins DNS results during control requests and does not follow redirects.
