#!/usr/bin/env bash
# Structure guard bridge for the preflight harness (spec 0009).
#
# Runs the web structure gate: ESLint structural rules (file/function budget,
# nesting, complexity, identical functions, layer boundaries), the jscpd
# duplication budget, and the file-size ratchet.
#
# Self-skips when the web workspace or its dependencies are absent — the
# harness self-test fixture and docs-only CI jobs have no `web/node_modules`.
# CI's `application-gate` is the authoritative gate; this bridge exists so
# local preflight and CI agree whenever dependencies are installed.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [[ ! -d "$ROOT/web" ]]; then
  echo "  skip: no web workspace under $ROOT"
  exit 0
fi

if [[ ! -x "$ROOT/web/node_modules/.bin/eslint" || ! -x "$ROOT/web/node_modules/.bin/jscpd" ]]; then
  echo "  skip: web dependencies not installed (run 'npm ci' in web/ to enable the structure guard)"
  exit 0
fi

cd "$ROOT/web"
npm run --silent check:structure
