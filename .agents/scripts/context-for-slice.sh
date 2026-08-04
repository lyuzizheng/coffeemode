#!/usr/bin/env bash
# Generate the shared minimal context for one implementation slice,
# including its implementation readiness gate (STOP / READY / COMPLETE).
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [ "$#" -ne 1 ]; then
  echo "Usage: .agents/scripts/context-for-slice.sh <slice-id>"
  exit 1
fi

exec ruby "$ROOT/.agents/scripts/implementation-slices.rb" context "$1"
