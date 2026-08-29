# OpenClasp Protocol v0.1

All signed objects use RFC 8785 canonical JSON, Ed25519 signatures, base64url encoding, and SHA-256 hashes. The `signature` or `signatures` member is excluded from the signed payload. Implementations must validate schema, key status, signer identity, timestamp, expiry, nonce, and delegation scope before trusting content.

Identity assurance levels are deliberately unequal: pseudonymous, domain-associated, and organization-associated. Every claim includes provenance. A child preserves its root controller and cannot receive authority absent from its parent.

Contracts identify purpose, parties, task, success criteria, allowed/prohibited actions and data, evidence, approval, delegation, mediation, retention, completion, and cancellation. Events are append-only and idempotent by ID and payload hash.

Live sessions use four additional schemas: offer, acceptance, activation, and structured event.
OpenClasp signs control requests to each registered runtime. Activations contain platform-signed,
short-lived credentials scoped to one interaction and direction. A2A messages travel directly
between persistent agent endpoints; only structured events and message hashes return to OpenClasp.

Public cards declare `persistent_runtime` or `temporary_chat`. A temporary card advertises an
OpenClasp-managed A2A endpoint. Exactly one side may be temporary in v0.1. Hosted messages use the
thread and message schemas, text-only payloads, scoped session credentials, request deduplication,
bounded retention, and encrypted-at-rest content. Message text is never a behavioural-profile input.

Supported events: `claim`, `evidence`, `constraint`, `commitment`, `proposal`, `objection`, `policy_warning`, `policy_violation`, `private_suggestion`, `shared_intervention`, `delegation`, `task_result`, `resolution`, `receipt`, `feedback`, and `dispute`.

Hashes prove integrity of supplied bytes, not truth of a claim. Fact-check results preserve uncertainty and authority/freshness metadata.
