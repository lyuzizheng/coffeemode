#!/usr/bin/env bash
# Classify changed repository paths into relevant CI jobs.
#
# Usage:
#   ... | classify-ci-paths.sh            # print the 5 gate flags for stdin paths
#   classify-ci-paths.sh --all            # force every gate
#   ... | classify-ci-paths.sh --strict    # same output, but exit 1 when any input
#                                          # path matched no rule (see "Rule coverage")
#
# Rule coverage (BRAWUKA-173): every tracked path must match exactly one rule
# below — including the deliberately ungated families, which get an explicit
# no-op arm instead of falling through silently. `--strict` turns a fall-through
# into a failure, and `.agents/scripts/check-ci-classification.sh` runs it over
# `git ls-files` on every CI run, so a new path family cannot ship without an
# explicit routing decision. A path that holds a `RUN_INTEGRATION=1` suite (or
# that such a suite consumes) MUST set `integration=true`; the same self-check
# derives that set from `web/package.json` and the test sources.
set -euo pipefail

application=false
integration=false
image_service=false
poi_service=false
docs=false

mode="classify"
case "${1:-}" in
  "") ;;
  --all) mode="all" ;;
  --strict) mode="strict" ;;
  *)
    echo "classify-ci-paths.sh: unknown argument: $1" >&2
    exit 2
    ;;
esac

mark_all() {
  application=true
  integration=true
  image_service=true
  poi_service=true
  docs=true
}

unmatched=()

if [[ "$mode" == "all" ]]; then
  mark_all
else
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      .github/workflows/*|.agents/scripts/classify-ci-paths.sh)
        mark_all
        ;;
      web/AGENTS.md|web/CLAUDE.md)
        docs=true
        ;;
      AGENTS.md|.agents/*|.codex/*|docs/*|.github/ISSUE_TEMPLATE/*|.github/pull_request_template.md|.github/prompts/*|.windsurf/*|README.md)
        docs=true
        ;;
      packages/common/*)
        application=true
        integration=true
        image_service=true
        poi_service=true
        ;;
      # Integration-gated web paths: real Postgres/PostGIS or real MinIO/R2.
      # `web/tests/db-helpers.test.ts` and `web/tests/devops/*` carry
      # `RUN_INTEGRATION` cases that only `integration-gate` executes;
      # `web/tests/integration/*` and `web/tests/helpers/*` are the suites and
      # their harness. Anything else under `web/tests/**` is unit-only and stays
      # out of the DB-backed gate.
      web/db/*|web/lib/*|web/app/api/*|web/scripts/migrate.mjs|web/package*.json)
        application=true
        integration=true
        ;;
      web/tests/integration/*|web/tests/helpers/*|web/tests/devops/*|web/tests/db-helpers.test.ts)
        application=true
        integration=true
        ;;
      web/*)
        application=true
        ;;
      # Repo-level structure-guard config (spec 0009): `application-gate` reads it
      # through `npm run check:structure`, and nothing else does.
      .jscpd.json)
        application=true
        ;;
      image-service/*)
        image_service=true
        integration=true
        ;;
      poi-service/*)
        poi_service=true
        ;;
      # Dokploy deployment definitions and the devops forwarders they ship with
      # delegate to `scripts/devops/*` (already integration-gated); the compose
      # stacks define the environments the DB-backed suites run against.
      deploy/*|docker-compose.yml|scripts/*)
        integration=true
        ;;
      # Explicitly ungated — no product code, script, or gate input reads these.
      #   _archive-coffeemode-frontend/, _archive-coffeemode-backend/
      #       legacy Vite/Java trees, reference only (`.agents/rules/coding.md`)
      #   database-data/
      #       raw dataset snapshot with no reader in this repository
      #   .gitignore, .DS_Store
      #       repository hygiene files
      _archive-*/*|database-data/*|.gitignore|.DS_Store|*.DS_Store)
        ;;
      *)
        unmatched+=("$path")
        ;;
    esac
  done
fi

printf 'application=%s\n' "$application"
printf 'integration=%s\n' "$integration"
printf 'image_service=%s\n' "$image_service"
printf 'poi_service=%s\n' "$poi_service"
printf 'docs=%s\n' "$docs"

if [[ "$mode" == "strict" && ${#unmatched[@]} -gt 0 ]]; then
  printf 'classify-ci-paths.sh: %d path(s) matched no rule:\n' "${#unmatched[@]}" >&2
  printf '  %s\n' "${unmatched[@]}" >&2
  printf 'Add a case arm (an explicit empty arm records "intentionally ungated").\n' >&2
  exit 1
fi
