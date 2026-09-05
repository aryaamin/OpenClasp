#!/usr/bin/env python3
"""Run baseline, generic-review, or OpenClasp Shield τ³ evaluations."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from tau2.data_model.simulation import TextRunConfig
from tau2.runner import run_domain

from openclasp_agent import close_shield_cases, register_openclasp_agents
from openclasp_client import OpenClaspMcpClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode", choices=["baseline", "generic-review", "shield"], required=True
    )
    parser.add_argument("--domain", default="airline")
    parser.add_argument("--task-ids", nargs="+")
    parser.add_argument("--num-tasks", type=int)
    parser.add_argument("--num-trials", type=int, default=1)
    parser.add_argument("--agent-llm", default="openai/gpt-4.1")
    parser.add_argument("--user-llm", default="openai/gpt-4.1")
    parser.add_argument("--generic-review-model")
    parser.add_argument("--max-concurrency", type=int, default=1)
    parser.add_argument("--seed", type=int, default=300)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--retrieval-config")
    parser.add_argument("--trigger", choices=["decisions", "actions", "all"], default="decisions")
    parser.add_argument("--save-to")
    parser.add_argument("--summary-file")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    save_to = args.save_to or f"openclasp_{args.mode.replace('-', '_')}_{args.domain}"
    summary_file = Path(args.summary_file or f"{save_to}_summary.json")
    os.environ["OPENCLASP_TAU_DOMAIN"] = args.domain
    os.environ["OPENCLASP_TAU_TRIGGER"] = args.trigger
    if args.generic_review_model:
        os.environ["OPENCLASP_GENERIC_REVIEW_MODEL"] = args.generic_review_model

    register_openclasp_agents()
    agent = {
        "baseline": "llm_agent",
        "generic-review": "openclasp_generic_review_agent",
        "shield": "openclasp_shield_agent",
    }[args.mode]
    if args.mode == "shield":
        token = os.getenv("OPENCLASP_AGENT_TOKEN", "")
        client = OpenClaspMcpClient(
            os.getenv("OPENCLASP_URL", "https://openclasp.dev"), token
        )
        client.call_tool("openclasp_shield_list_cases", {})
    else:
        client = None

    config = TextRunConfig(
        domain=args.domain,
        agent=agent,
        llm_agent=args.agent_llm,
        llm_user=args.user_llm,
        llm_args_agent={"temperature": args.temperature},
        llm_args_user={"temperature": args.temperature},
        task_ids=args.task_ids,
        num_tasks=args.num_tasks,
        num_trials=args.num_trials,
        max_concurrency=args.max_concurrency,
        workers=0,
        seed=args.seed,
        retrieval_config=args.retrieval_config,
        save_to=save_to,
    )
    results = run_domain(config)
    shield_cases = close_shield_cases(results, client) if client else []
    rewards = [
        simulation.reward_info.reward
        for simulation in results.simulations
        if simulation.reward_info and simulation.reward_info.reward is not None
    ]
    summary = {
        "mode": args.mode,
        "domain": args.domain,
        "agent": agent,
        "agentModel": args.agent_llm,
        "userModel": args.user_llm,
        "seed": args.seed,
        "numTrials": args.num_trials,
        "simulationCount": len(results.simulations),
        "averageReward": sum(rewards) / len(rewards) if rewards else None,
        "passCount": sum(reward >= 0.999 for reward in rewards),
        "rewards": rewards,
        "simulations": [
            {
                "simulationId": simulation.id,
                "taskId": simulation.task_id,
                "trial": simulation.trial,
                "seed": simulation.seed,
                "reward": simulation.reward_info.reward if simulation.reward_info else None,
                "termination": str(simulation.termination_reason.value),
                "agentCost": simulation.agent_cost,
                "duration": simulation.duration,
            }
            for simulation in results.simulations
        ],
        "shieldCases": shield_cases,
    }
    summary_file.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"OpenClasp experiment summary: {summary_file.resolve()}")


if __name__ == "__main__":
    main()
