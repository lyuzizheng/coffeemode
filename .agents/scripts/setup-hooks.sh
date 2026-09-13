#!/usr/bin/env bash
# Install pre-commit hooks for CoffeeMode.
# One-command setup for new clones.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v pre-commit >/dev/null 2>&1; then
  echo "pre-commit not found. Install it first:"
  echo "  brew install pre-commit   # macOS"
  echo "  pip install pre-commit    # or via pip"
  exit 1
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not found. Install it first:"
  echo "  brew install gitleaks     # macOS"
  echo "  go install github.com/gitleaks/gitleaks/v8@v8.30.1"
  exit 1
fi

pre-commit install
echo "pre-commit hooks installed."
echo "Verify: git add a file with a fake secret and try to commit — it should be blocked."
