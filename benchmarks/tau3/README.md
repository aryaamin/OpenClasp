# OpenClasp Shield on τ³-bench

This adapter evaluates a protected customer-service agent in three controlled conditions:

- `baseline`: the unmodified τ³ `llm_agent`;
- `generic-review`: the same agent with a generic second-model review;
- `shield`: the same agent with an OpenClasp Shield consultation.

Shield sees only the domain policy visible to the tested agent, visible user messages, tool results,
and the agent's drafted next step. It never receives the task description, expected actions, reward,
evaluator state, or even the benchmark task ID. Consultation text is transient; OpenClasp stores the
structured assessment, model/token metadata, and the final benchmark outcome.

These are custom τ³ runs because the treatment changes the agent scaffold. Do not report them as a
standard model-only leaderboard submission.

## 1. Install τ³

Install [`uv`](https://docs.astral.sh/uv/getting-started/installation/), then from the OpenClasp
repository:

```bash
bash benchmarks/tau3/setup_tau3.sh ../tau2-bench
cd ../tau2-bench
```

Edit `.env` and add the provider keys required by the protected-agent and user-simulator models.
For the default commands below, add `OPENAI_API_KEY`.

## 2. Deploy and configure OpenClasp

Deploy the current OpenClasp changes with `ANTHROPIC_API_KEY` set on the deployment. In the OpenClasp
dashboard, open **Shield**, select an existing connected agent, and create a seven-day τ³ token. Copy
it immediately; only its hash is stored.

In the shell running τ³:

```bash
export OPENCLASP_URL=https://openclasp.dev
export OPENCLASP_AGENT_TOKEN='oc_at_...'
```

Do not put the token in Git or a command-line argument.

## 3. Run the exact cancellation smoke test

The cancellation scenario for reservation `EHGLP3` is current airline task `0`.

```bash
uv run python ../openclasp/benchmarks/tau3/run_experiment.py \
  --mode baseline --domain airline --task-ids 0 --num-trials 1 \
  --agent-llm openai/gpt-4.1 --user-llm openai/gpt-4.1 \
  --save-to oc_baseline_smoke --summary-file oc_baseline_smoke.json

uv run python ../openclasp/benchmarks/tau3/run_experiment.py \
  --mode shield --domain airline --task-ids 0 --num-trials 1 \
  --agent-llm openai/gpt-4.1 --user-llm openai/gpt-4.1 \
  --save-to oc_shield_smoke --summary-file oc_shield_smoke.json
```

Open the trajectories with `uv run tau2 view`. The smoke test proves wiring only.

## 4. Run a controlled sample

Use identical domain, models, task IDs, trials, seed, temperature, and concurrency for all three
runs. Start with 20 airline tasks and four trials:

```bash
for mode in baseline generic-review shield; do
  uv run python ../openclasp/benchmarks/tau3/run_experiment.py \
    --mode "$mode" --domain airline --num-tasks 20 --num-trials 4 \
    --seed 300 --temperature 0 --max-concurrency 1 \
    --agent-llm openai/gpt-4.1 --user-llm openai/gpt-4.1 \
    --save-to "oc_${mode}_airline_20x4" \
    --summary-file "oc_${mode}_airline_20x4.json"
done
```

Compare matched runs:

```bash
uv run python ../openclasp/benchmarks/tau3/compare_results.py \
  --baseline oc_baseline_airline_20x4.json \
  --generic-review oc_generic-review_airline_20x4.json \
  --shield oc_shield_airline_20x4.json
```

Only proceed to every task after the smoke test and controlled sample work. A Shield improvement over
baseline but not generic review means extra inference helped; it does not yet prove OpenClasp's
specialized method helped. The meaningful signal is Shield outperforming both.

## Configuration

- `--trigger decisions` reviews user-facing responses and state-changing tool calls while skipping
  obvious read-only lookups. Use `actions` for state-changing tools only or `all` for every draft.
- `OPENCLASP_GENERIC_REVIEW_MODEL` selects the ablation reviewer; it defaults to the protected-agent
  model.
- Shield fallback mode fails the run by default. This prevents an unconfigured Anthropic key from
  silently producing fake treatment results. `OPENCLASP_ALLOW_SHIELD_FALLBACK=true` is only for
  transport debugging.
- The adapter deliberately uses `workers=0`; thread concurrency is supported, process workers are not
  because post-run outcomes must map back to their Shield cases.
