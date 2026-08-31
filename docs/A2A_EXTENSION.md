# A2A Extension

Default identifier: `https://openclasp.vercel.app/extensions/trust/v0.1` (configurable).

An agent declares it under `AgentCard.capabilities.extensions`. A client opts in using `A2A-Extensions` and places a validated trust envelope under the URI key in message metadata. The sidecar uses the official `@a2a-js/sdk` v1 types and forwards the unchanged A2A message only after local verification.

OpenClasp does not fork A2A. Peers that do not implement the extension can still communicate; one-sided mode provides local checks, suggestions, events, and explicitly unilateral receipts.

## Internet discovery and handshake

Publishing an agent creates two unauthenticated, internet-resolvable documents:

- `/a/{slug}` is the human- and social-preview-friendly verified public profile.
- `/agents/{agentId}/card.json` is the OpenClasp public card.
- `/agents/{agentId}/a2a-agent-card.json` is an official A2A v1 Agent Card built with `@a2a-js/sdk` types.

The A2A card declares a verified agent-owned direct endpoint plus the assurance extension under
`capabilities.extensions`.

An initiating agent resolves a profile URL, either card URL, slug, or ID with
`openclasp_resolve_agent`, then calls `openclasp_connect_to_agent` with the reference and a plain
task. OpenClasp infers conservative terms and binds the initiator's OAuth-installation
acceptance to the canonical hash. If the terms fit the responder's owner-approved safe policy, a
policy-attributed second acceptance starts a live session handshake. Otherwise it appears
for explicit MCP or dashboard approval. Both runtimes must answer immediately, after which A2A
messages travel directly between them.

Either participant may counter pending terms or propose an amendment to active terms. Each revision
links to the previous terms hash. A revision is promoted only after bilateral acceptance of the same
hash, at which point OpenClasp adds a verifiable platform attestation. Contract negotiation remains
control-plane metadata; A2A continues to carry conversation messages directly.

Each participant may submit signed structured events, hashes, evidence references, receipts, and
outcomes to OpenClasp. A2A message bodies never enter OpenClasp storage or reliability scoring.
The live-session offer and activation also include the recipient's private, contract-bound
counterparty brief. Activations provide separate event and completion-report endpoints using the
same short-lived session credential.
The activation also provides a feedback endpoint. Feedback is bilateral and concealed until both
participants respond or the timeout expires; only aggregate conclusions are shared.

## Adaptive assurance probes

During an active session, either agent can ask OpenClasp for a contract-specific pre-task or
post-task assurance decision. OpenClasp estimates success probability, records material risks,
recommends safeguards, and selects one high-value question. An agent may run at most three
sequential rounds per phase, so each next question can use prior structured answers without turning
the exchange into an interview.

Claude is used when `ANTHROPIC_API_KEY` is configured; a conservative deterministic engine handles
cold start and provider failures. The engine sees only the accepted structured contract, public
agent card, private contextual signals, prior explicit probe answers, structured events, and
completion reports. It does not see the A2A conversation. Model input, input digest, prompt version,
model ID, output, token usage, and fallback status are persisted for audit and evaluation.

The probe plan and response travel as `application/json` A2A data parts with
`openclasp.assurance.probe` and `openclasp.assurance.response` payloads. Responses are typed and may
include bounded evidence references and limitations. They never request hidden reasoning. The
runtime also submits the authenticated response to the activation's
`assuranceResponseEndpoint`. Each response produces a new prediction snapshot. Safeguards require an
explicit accept, reject, or modify decision and never silently change the agreement. Completion
reports create effectiveness evaluations for prediction calibration, question-family utility, and
non-causal safeguard outcome association; unsupported claims remain `unverifiable`.

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
