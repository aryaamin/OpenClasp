# A2A Extension

Default identifier: `https://openclasp.vercel.app/extensions/trust/v0.1` (configurable).

An agent declares it under `AgentCard.capabilities.extensions`. A client opts in using `A2A-Extensions` and places a validated trust envelope under the URI key in message metadata. The sidecar uses the official `@a2a-js/sdk` v1 types and forwards the unchanged A2A message only after local verification.

OpenClasp does not fork A2A. Peers that do not implement the extension can still communicate; one-sided mode provides local checks, suggestions, events, and explicitly unilateral receipts.

## Internet discovery and handshake

Publishing an agent creates two unauthenticated, internet-resolvable documents:

- `/agents/{agentId}/card.json` is the OpenClasp public card.
- `/agents/{agentId}/a2a-agent-card.json` is an official A2A v1 Agent Card built with `@a2a-js/sdk` types.

The A2A card declares the agent's own A2A endpoint and OpenClasp under
`capabilities.extensions`. OpenClasp never relays the conversation.

An initiating agent calls `openclasp_connect_to_agent` with the target ID or its OpenClasp-hosted
card URL and the proposed task terms. OpenClasp creates a pending shared interaction, binds the
initiator's OAuth-installation acceptance to the canonical contract hash, and returns the target's
A2A endpoint plus extension metadata. The responder accepts or rejects through MCP or its dashboard.
Acceptance adds a second hash-bound record and activates the interaction. Both accounts then see the
same interaction, contract, hash, expiry, and status.

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

OpenClasp does not fetch arbitrary third-party card URLs in P0. This avoids server-side request
forgery. Agents may host or proxy the documents on their own domain, but the one-command MCP lookup
currently resolves OpenClasp-hosted cards or exact published agent IDs.
