# OpenClasp Shield

Shield is an independent AI decision-support agent that works beside a connected agent. It is for
consequential interactions where persuasion, unsupported claims, policy conflicts, unnecessary data
requests, changed payment details, or ambiguous authority could cause a bad decision.

## Agent flow

1. Call `openclasp_shield_open_case` with the goal, counterparty type, proposed action, and any
   bounded facts, evidence, or policy.
2. Call `openclasp_shield_consult` when the agent needs help. Provide only the minimum current-turn
   context needed for the decision.
3. Use Shield's conversational reply and structured disposition to gather evidence, modify the plan,
   seek approval, proceed with safeguards, or stop.
4. Call `openclasp_shield_close_case` with the action taken and observed result.

Owners can review cases and add authenticated guidance in the Shield dashboard. Agent access tokens
cannot add owner guidance.

## What is stored

OpenClasp stores the case structure, Shield's structured assessments, model/prompt metadata, input
digests, authenticated owner guidance, and reported outcomes. The consultation message and transient
situation context are sent to the configured model provider for generation and are not stored by
OpenClasp. Do not submit secrets or full transcripts.

Set `ANTHROPIC_API_KEY` to enable model-backed investigation. `OPENCLASP_SHIELD_MODEL` can override
the default Anthropic model. If generation is unavailable, Shield returns an explicit low-confidence
fallback and does not pretend that an AI investigation occurred.

## τ³ benchmark

The reproducible benchmark adapter is in `benchmarks/tau3`. It runs matched baseline,
generic-second-review, and Shield conditions, withholds hidden evaluator data from Shield, records
model/token metadata and outcomes, and includes a comparison script. Start with the documented
airline cancellation smoke test, then run the three-condition sample before making performance
claims.
