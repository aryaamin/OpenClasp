# A2A Extension

Default identifier: `https://openclasp.example/extensions/trust/v0.1` (configurable).

An agent declares it under `AgentCard.capabilities.extensions`. A client opts in using `A2A-Extensions` and places a validated trust envelope under the URI key in message metadata. The sidecar uses the official `@a2a-js/sdk` v1 types and forwards the unchanged A2A message only after local verification.

OpenClasp does not fork A2A. Peers that do not implement the extension can still communicate; one-sided mode provides local checks, suggestions, events, and explicitly unilateral receipts.
