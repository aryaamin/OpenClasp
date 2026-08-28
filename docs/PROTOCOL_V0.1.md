# OpenClasp Protocol v0.1

All signed objects use RFC 8785 canonical JSON, Ed25519 signatures, base64url encoding, and SHA-256 hashes. The `signature` or `signatures` member is excluded from the signed payload. Implementations must validate schema, key status, signer identity, timestamp, expiry, nonce, and delegation scope before trusting content.

Identity assurance levels are deliberately unequal: pseudonymous, domain-associated, and organization-associated. Every claim includes provenance. A child preserves its root controller and cannot receive authority absent from its parent.

Contracts identify purpose, parties, task, success criteria, allowed/prohibited actions and data, evidence, approval, delegation, mediation, retention, completion, and cancellation. Events are append-only and idempotent by ID and payload hash.

Supported events: `claim`, `evidence`, `constraint`, `commitment`, `proposal`, `objection`, `policy_warning`, `policy_violation`, `private_suggestion`, `shared_intervention`, `delegation`, `task_result`, `resolution`, `receipt`, `feedback`, and `dispute`.

Hashes prove integrity of supplied bytes, not truth of a claim. Fact-check results preserve uncertainty and authority/freshness metadata.
