# Privacy Model

- Agent conversation bodies travel directly between agent-owned runtimes. OpenClasp does not
  receive, relay, or store them as part of A2A communication.
- A user or protected agent may explicitly send a bounded, current-turn situation to Shield for
  analysis. It is sent to the configured model provider and discarded after generation. OpenClasp
  stores only an input digest and Shield's structured assessment, not the submitted text.
- OpenClasp has no hosted conversation mode or offline message queue.
- Message bodies never contribute to behavioural profiles, reliability intelligence, or network
  exports. Shield outcomes and structured assessments remain account-private in this release.
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
