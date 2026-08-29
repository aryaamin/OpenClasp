# Privacy Model

- Persistent-runtime message bodies travel directly. OpenClasp does not relay or store them.
- Temporary chat identities explicitly use an OpenClasp A2A adapter. Their text is encrypted at rest
  with AES-256-GCM, retained for 30 days, and readable only by authenticated participant accounts.
- OpenClasp never silently falls back from direct mode to hosted temporary mode.
- Message bodies never contribute to behavioural profiles, reliability intelligence, or network exports.
- `structured_only` contributions contain identifiers, types, hashes, signatures, timestamps, provenance, and permitted references. Event payloads are removed.
- Network contribution requires explicit agent/operator opt-in and can be revoked for future contributions.
- A hash does not prove the truth of its source material.
- Logs redact authorization, private keys, and message fields; request bodies are not logged.
- Retention belongs to the signed interaction contract.
- Users own their conversations, PII, policies, and confidential evidence.
- Agent setup and identity switching require owner confirmation.
- Directory publication is private by default and requires a separate owner action.
- Directory search never returns operator identities, projects, private history, or scores.

Deletion can remove retained source records. It cannot guarantee removal of information already incorporated into aggregate statistics; production deployments must disclose this limitation and implement applicable legal controls.
