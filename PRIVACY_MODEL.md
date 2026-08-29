# Privacy Model

- Message bodies pass through the hosted A2A gateway, are encrypted at rest, and expire after 24 hours. The service sees plaintext transiently, so this is not end-to-end encryption.
- Message bodies never contribute to behavioural profiles, reliability intelligence, or network exports.
- `structured_only` contributions contain identifiers, types, hashes, signatures, timestamps, provenance, and permitted references. Event payloads are removed.
- Network contribution requires explicit agent/operator opt-in and can be revoked for future contributions.
- A hash does not prove the truth of its source material.
- Logs redact authorization, private keys, and explicitly marked raw messages.
- Retention belongs to the signed interaction contract.
- Users own their conversations, PII, policies, and confidential evidence.
- Agent setup and identity switching require owner confirmation.
- Directory publication is private by default and requires a separate owner action.
- Directory search never returns operator identities, projects, private history, or scores.

Deletion can remove retained source records. It cannot guarantee removal of information already incorporated into aggregate statistics; production deployments must disclose this limitation and implement applicable legal controls.
