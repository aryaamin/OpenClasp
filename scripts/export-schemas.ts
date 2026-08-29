import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  AgentIdentitySchema,
  AgentPresenceSchema,
  AgentTransportSchema,
  DelegationCredentialSchema,
  ExpectationManifestSchema,
  FactCheckResultSchema,
  FeedbackSchema,
  InteractionContractSchema,
  InteractionEventSchema,
  FederatedInteractionSchema,
  PublicAgentCardSchema,
  ReceiptSchema,
  RiskDecisionSchema,
  RuntimeDeliverySchema,
  TrustEnvelopeSchema,
} from '@openclasp/protocol';

const schemas = {
  agent_identity: AgentIdentitySchema,
  delegation_credential: DelegationCredentialSchema,
  expectation_manifest: ExpectationManifestSchema,
  interaction_contract: InteractionContractSchema,
  trust_envelope: TrustEnvelopeSchema,
  interaction_event: InteractionEventSchema,
  fact_check_result: FactCheckResultSchema,
  receipt: ReceiptSchema,
  feedback: FeedbackSchema,
  risk_decision: RiskDecisionSchema,
  agent_transport: AgentTransportSchema,
  agent_presence: AgentPresenceSchema,
  runtime_delivery: RuntimeDeliverySchema,
  public_agent_card: PublicAgentCardSchema,
  federated_interaction: FederatedInteractionSchema,
};
await mkdir('schemas/v0.1', { recursive: true });
await Promise.all(
  Object.entries(schemas).map(([name, schema]) =>
    writeFile(
      `schemas/v0.1/${name}.schema.json`,
      `${JSON.stringify(z.toJSONSchema(schema, { target: 'draft-2020-12' }), null, 2)}\n`,
    ),
  ),
);
