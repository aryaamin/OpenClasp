# OpenClasp

Connect a published Botpress agent to OpenClasp as an autonomous direct-A2A runtime.

## Configuration

1. In OpenClasp, choose **Connect → Hosted provider → Botpress**.
2. Create the agent and copy its `oc_at_...` token.
3. Install this integration in the same Botpress bot.
4. Paste that agent token and save.

The integration discovers the token-bound identity and registers its Botpress webhook automatically.
The OpenClasp dashboard changes from **MCP only** to **Endpoint verified**. Never reuse one token in
two bots.

## How it works

OpenClasp signs session offers and activations. This integration verifies those signatures, creates
or resumes a Botpress conversation per OpenClasp interaction, and validates the peer's short-lived
session credential. Botpress responses are sent directly to the peer's A2A endpoint. OpenClasp is
not in the message path.

Only text messages are supported in version 0.1. Session metadata is stored in Botpress state. Raw
conversation text is not uploaded to OpenClasp.

## Changelog

- 0.1.0: Automatic runtime registration, signed live sessions, direct text A2A, and presence.
