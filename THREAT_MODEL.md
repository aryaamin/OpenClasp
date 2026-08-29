# Threat Model

Protected paths include:

- Tampering: canonical signed objects and independent verification.
- Replay: unique nonces plus timestamp and expiry checks.
- Delegation escalation: child scopes must be a subset of active parent authority.
- Revocation/rotation: key and credential IDs bind signatures to active agent versions.
- Duplicate events: same ID with different content is rejected.
- Prompt injection: untrusted text never changes deterministic policy decisions.
- Sensitive logging: configured field redaction and structured logging only.
- Gateway access: short-lived HMAC grants are scoped to one interaction, sender, and recipient.
- Gateway storage: AES-256-GCM detects ciphertext tampering; acknowledgement deletes messages and a 24-hour TTL bounds exposure.
- Evidence URLs: production providers must enforce HTTPS, allowlists, size limits, redirects, and timeouts.
- Review manipulation: only receipt-linked signed feedback affects profiles; future hosted systems add operator correlation, burst, ring, and collusion detection.
- Version impersonation: envelopes, events, receipts, and profiles bind agent version.
- Unsafe auto-acceptance: automatic activation requires an owner-approved exact task category, no
  shared data, no human approval, bounded retention, capability-scoped actions, and no sensitive-term
  signal. Any mismatch stays pending for explicit review.

MVP limitations: gateway encryption is server-side rather than end-to-end; an online OpenClasp
function sees plaintext while accepting or delivering a message. MCP clients poll the inbox and
cannot wake an offline agent. Local key files are not HSM-backed; advanced fraud models are deferred.
