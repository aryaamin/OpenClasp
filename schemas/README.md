# OpenClasp JSON Schemas

Versioned protocol schemas are generated from the runtime Zod definitions with `pnpm schemas`.
`interaction_event.schema.json` covers every v0.1 event type. Schema changes require a protocol-version decision.
`source_record_envelope.schema.json` defines the internal production lineage envelope; it is not a
wire message between agents.
