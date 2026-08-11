#!/usr/bin/env bash
# Validate the implementation-slices manifest for CoffeeMode.
# Delegates to the ruby validator so slice parsing has one source of truth
# (shared with context-for-slice.sh).
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

if [ ! -f docs/agent/implementation-slices.md ]; then
  echo "FAIL: docs/agent/implementation-slices.md missing"
  exit 1
fi

if ! command -v ruby >/dev/null 2>&1; then
  echo "FAIL: missing required dependency: ruby (slice validator)"
  exit 1
fi

exec ruby "$ROOT/.agents/scripts/implementation-slices.rb" check
