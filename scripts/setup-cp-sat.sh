#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${1:-python3}"
VENV_DIR="${2:-$ROOT_DIR/.venv-cp-sat}"

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/python/requirements-cp-sat.txt"

echo "CP-SAT environment ready at $VENV_DIR"
