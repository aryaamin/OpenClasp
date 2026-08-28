# Privacy Model

- Raw conversation content and confidential evidence stay local by default.
- `structured_only` contributions contain identifiers, types, hashes, signatures, timestamps, provenance, and permitted references. Event payloads are removed.
- Network contribution requires explicit agent/operator opt-in and can be revoked for future contributions.
- A hash does not prove the truth of its source material.
- Logs redact authorization, private keys, and explicitly marked raw messages.
- Retention belongs to the signed interaction contract.
- Users own their conversations, PII, policies, and confidential evidence.

Deletion can remove retained source records. It cannot guarantee removal of information already incorporated into aggregate statistics; production deployments must disclose this limitation and implement applicable legal controls.
