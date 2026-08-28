# Threat Model

Protected paths include:

- Tampering: canonical signed objects and independent verification.
- Replay: unique nonces plus timestamp and expiry checks.
- Delegation escalation: child scopes must be a subset of active parent authority.
- Revocation/rotation: key and credential IDs bind signatures to active agent versions.
- Duplicate events: same ID with different content is rejected.
- Prompt injection: untrusted text never changes deterministic policy decisions.
- Sensitive logging: configured field redaction and structured logging only.
- Evidence URLs: production providers must enforce HTTPS, allowlists, size limits, redirects, and timeouts.
- Review manipulation: only receipt-linked signed feedback affects profiles; future hosted systems add operator correlation, burst, ring, and collusion detection.
- Version impersonation: envelopes, events, receipts, and profiles bind agent version.

MVP limitations: local key files are not HSM-backed; identity associations are demonstrations; advanced URL fetching and production fraud models are deferred.
