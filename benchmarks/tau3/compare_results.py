#!/usr/bin/env python3
"""Compare matched τ³ baseline, generic-review, and Shield summaries."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--generic-review", required=True)
    parser.add_argument("--shield", required=True)
    return parser.parse_args()


def load(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def keyed(value: dict[str, Any]) -> dict[tuple[str, int], float]:
    return {
        (str(row["taskId"]), int(row["trial"])): float(row["reward"])
        for row in value["simulations"]
        if row.get("reward") is not None
    }


def stats(name: str, value: dict[str, Any]) -> str:
    count = int(value["simulationCount"])
    average = value.get("averageReward")
    passes = int(value["passCount"])
    reward_text = "n/a" if average is None else f"{float(average):.4f}"
    pass_text = "n/a" if count == 0 else f"{passes / count:.1%}"
    return f"{name:16} n={count:4d}  reward={reward_text:>6}  pass={pass_text}"


def paired_delta(left: dict[str, Any], right: dict[str, Any]) -> tuple[float, int]:
    left_rows = keyed(left)
    right_rows = keyed(right)
    common = sorted(left_rows.keys() & right_rows.keys())
    if not common:
        raise ValueError("Runs have no matching task/trial pairs")
    return sum(right_rows[key] - left_rows[key] for key in common) / len(common), len(common)


def main() -> None:
    args = parse_args()
    baseline = load(args.baseline)
    generic = load(args.generic_review)
    shield = load(args.shield)
    signatures = {
        (value["domain"], value["agentModel"], value["userModel"], value["seed"], value["numTrials"])
        for value in (baseline, generic, shield)
    }
    if len(signatures) != 1:
        raise ValueError("Runs are not comparable: domain/model/seed/trial settings differ")
    vs_baseline, baseline_pairs = paired_delta(baseline, shield)
    vs_generic, generic_pairs = paired_delta(generic, shield)
    print(stats("baseline", baseline))
    print(stats("generic review", generic))
    print(stats("OpenClasp Shield", shield))
    print()
    print(f"Shield − baseline:       {vs_baseline:+.4f} reward ({baseline_pairs} paired runs)")
    print(f"Shield − generic review: {vs_generic:+.4f} reward ({generic_pairs} paired runs)")


if __name__ == "__main__":
    main()
