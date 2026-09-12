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
# explicit routing decision. A path that holds a `RUN_INTEGRATION=1` suite, or
# that such a suite consumes, MUST set `integration=true` — and inside
# `web/tests/**` that is the *default*, not something each new harness file has
# to be added for: a suite's fixture can be reached by static import, dynamic
# import, or an `fs` read by path, so no import-based rule is complete there
# (BRAWUKA-206). The same self-check derives the import-reachable set from
# `web/package.json`, the test sources, and the vitest config, asserts it over
# the sources rather than the arms below, and fails on a specifier it cannot
# resolve instead of silently shrinking the set.
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
      # `web/db/*`, `web/lib/*`, and `web/app/api/*` are the layers the gated
      # suites exercise; `web/shared/*` and `web/types/*` are the runtime modules
      # they import (same policy as `packages/common/*`); `web/config/*` is the
      # product configuration `web/lib/config.ts` loads at import time (rate
      # limits and budgets the HTTP suites assert on); `web/scripts/*` is gate and
      # migration machinery the suites invoke by path (`migrate.mjs`,
      # `cleanup-stale-test-dbs.mjs`), the same policy as repo-level `scripts/*`.
      web/db/*|web/lib/*|web/app/api/*|web/shared/*|web/types/*|web/config/*|web/scripts/*|web/package*.json)
        application=true
        integration=true
        ;;
      # The gated suites plus the harness they are known to read:
      # `web/tests/integration/*` are the suites, `helpers/*` and `fixtures/*`
      # their harness, `devops/*` and `db-helpers.test.ts` carry their own
      # `RUN_INTEGRATION` cases, `setup.ts` runs ahead of every suite (vitest
      # `setupFiles`), and `mocks/*` is reached through the `server-only` alias.
      # This arm is matched before the unit-only allowlist below so a gated
      # suite nested in a unit-only family cannot fall through to it.
      web/tests/integration/*|web/tests/helpers/*|web/tests/fixtures/*|web/tests/devops/*|web/tests/mocks/*|web/tests/db-helpers.test.ts|web/tests/setup.ts)
        application=true
        integration=true
        ;;
      # Unit-only test files (explicit allowlist): a `*.test.ts(x)` here outside
      # the gated arm passes without Postgres, so scheduling the DB-backed gate
      # for it would only cost CI minutes. Matched by test-file pattern, not by
      # directory, so a *non-test* file dropped into one of these families stays
      # in the fail-safe default arm below instead of inheriting unit-only
      # (BRAWUKA-206 review). Four levels covers the deepest suite in the tree;
      # anything deeper falls to the default, which is the safe direction.
      web/tests/*.test.ts|web/tests/*.test.tsx|web/tests/*/*.test.ts|web/tests/*/*.test.tsx|web/tests/*/*/*.test.ts|web/tests/*/*/*.test.tsx|web/tests/*/*/*/*.test.ts|web/tests/*/*/*/*.test.tsx)
        application=true
        ;;
      # Fail-safe default for the rest of the test tree: anything under
      # `web/tests/**` that is neither a gated suite nor a unit-only test file is
      # harness — a fixture, helper, snapshot, or data file some suite reads.
      # A suite's result is only proven where the suite runs, and a fixture can
      # be reached by static import, dynamic import, or an `fs` read by path, so
      # no import-based rule can be complete here. Gating the whole family by
      # default makes the failure direction safe: a new harness file starts
      # `integration-gate` immediately instead of landing ungated, and
      # `.agents/scripts/check-ci-classification.sh` asserts the same property
      # over every tracked non-test file under `web/tests/**`.
      web/tests/*)
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
      # Secret-scanning config: `.gitleaks.toml` is read by the `secret-scan` job
      # in `ci.yml` and by `secret-scan.yml`; `.pre-commit-config.yaml` is the
      # local hook manifest. Neither is a product gate input, but both must be
      # classified so `check-ci-classification.sh` does not flag them.
      .gitleaks.toml|.pre-commit-config.yaml)
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
