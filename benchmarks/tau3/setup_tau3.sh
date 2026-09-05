#!/usr/bin/env bash
set -euo pipefail

tau_dir="${1:-../tau2-bench}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

if [ ! -d "$tau_dir/.git" ]; then
  git clone https://github.com/sierra-research/tau2-bench.git "$tau_dir"
fi

uv sync --project "$tau_dir" --extra dev

if [ ! -f "$tau_dir/.env" ]; then
  cp "$tau_dir/.env.example" "$tau_dir/.env"
fi

echo "τ³ is installed at $tau_dir"
echo "Add your protected-agent and user-simulator API keys to $tau_dir/.env"
