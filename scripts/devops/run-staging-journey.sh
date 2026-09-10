#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Staging User-Journey Runner
# Lifecycle:    docs/devops/LIFECYCLE.md (staging verification)
# Test layers: docs/specs/0003-testing-and-ci.md
#
# Before-run setup + full user-journey verification + after-run cleanup against
# a staging Supabase Postgres — the staging counterpart of the CI
# `integration-gate` (which runs the same suites against local PostGIS).
#
#   1. Setup: idempotent migrations + RLS + auth verify via
#      scripts/devops/setup-supabase.mjs (skippable with --skip-setup).
#   2. Run: real-DB journey suites (API calls + stored-state assertions) with
#      ALLOW_REMOTE_INTEGRATION_DB=1. Each suite provisions isolated
#      `{prefix}_{pid}_{uuid}` databases and drops them in afterAll.
#   3. Cleanup: drop orphaned test databases left by crashed runs via
#      web/scripts/cleanup-stale-test-dbs.mjs --apply (skippable).
#
# Never touches production: STAGING_DATABASE_URL is required and has no
# default, so a bare invocation fails fast instead of running against local
# dev or prod. Never run two instances concurrently against one server.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

SUITE="journey"
SKIP_SETUP=0
SETUP_VERIFY_ONLY=0
SETUP_DRY_RUN=0
SKIP_CLEANUP=0
DRY_RUN=0

log()  { echo "[staging-journey] $*"; }
warn() { echo "[staging-journey] WARN: $*" >&2; }
fail() { echo "[staging-journey] FAIL: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
CoffeeMode Staging User-Journey Runner

Usage:
  STAGING_DATABASE_URL=postgres://... scripts/devops/run-staging-journey.sh [options]

Options:
  --suite <journey|http|db|all>  Which suites to run (default: journey)
  --skip-setup                   Skip setup-supabase.mjs provisioning
  --setup-verify-only            Pass --verify-only to setup (no DDL/mutations)
  --setup-dry-run                Pass --dry-run to setup (log planned actions)
  --skip-cleanup                 Skip stale test-database sweep at the end
  --dry-run                      Print the plan without running anything
  -h, --help                     Show this help message and exit

Environment:
  STAGING_DATABASE_URL        Required. Staging Postgres connection string.
  SUPABASE_URL                Optional. Enables Supabase Auth endpoint checks.
  SUPABASE_SERVICE_ROLE_KEY   Optional. Enables privileged setup verification.
  SUPABASE_ANON_KEY           Optional. Enables anon auth checks.

Without Supabase keys the setup step runs with --skip-auth (DB provisioning
and verification only). Production databases are never targeted: there is no
default URL, and non-local hosts always require ALLOW_REMOTE_INTEGRATION_DB=1.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --suite) SUITE="${2:-}"; shift 2 ;;
    --skip-setup) SKIP_SETUP=1; shift ;;
    --setup-verify-only) SETUP_VERIFY_ONLY=1; shift ;;
    --setup-dry-run) SETUP_DRY_RUN=1; shift ;;
    --skip-cleanup) SKIP_CLEANUP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
done

case "$SUITE" in
  journey|http|db|all) ;;
  *) fail "Invalid --suite: $SUITE (expected journey|http|db|all)" ;;
esac

[[ -n "${STAGING_DATABASE_URL:-}" ]] || fail "STAGING_DATABASE_URL is required (no default; refusing to guess)"
export ALLOW_REMOTE_INTEGRATION_DB=1
export DATABASE_URL="$STAGING_DATABASE_URL"
export RUN_INTEGRATION=1

SETUP_ARGS=(--database-url "$STAGING_DATABASE_URL")
if [[ -n "${SUPABASE_URL:-}" ]]; then
  SETUP_ARGS+=(--supabase-url "$SUPABASE_URL")
else
  warn "SUPABASE_URL unset — setup will run with --skip-auth (DB only)"
  SETUP_ARGS+=(--skip-auth)
fi
[[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && SETUP_ARGS+=(--service-role-key "$SUPABASE_SERVICE_ROLE_KEY")
[[ -n "${SUPABASE_ANON_KEY:-}" ]] && SETUP_ARGS+=(--anon-key "$SUPABASE_ANON_KEY")
[[ "$SETUP_VERIFY_ONLY" == "1" ]] && SETUP_ARGS+=(--verify-only)
[[ "$SETUP_DRY_RUN" == "1" ]] && SETUP_ARGS+=(--dry-run)

case "$SUITE" in
  journey) SUITE_CMDS=("npm run test:integration:journey") ;;
  http)    SUITE_CMDS=("npm run test:integration:http") ;;
  db)      SUITE_CMDS=("npm run test:integration") ;;
  all)     SUITE_CMDS=("npm run test:integration"
                       "npm run test:integration:journey"
                       "npm run test:integration:http") ;;
esac

if [[ "$DRY_RUN" == "1" ]]; then
  log "Plan (dry-run; nothing executed):"
  [[ "$SKIP_SETUP" == "0" ]] && log "  1. setup: node scripts/devops/setup-supabase.mjs ${SETUP_ARGS[*]}"
  [[ "$SKIP_SETUP" == "1" ]] && log "  1. setup: skipped"
  i=2
  for cmd in "${SUITE_CMDS[@]}"; do
    log "  $i. run (cd web): $cmd"
    i=$((i + 1))
  done
  [[ "$SKIP_CLEANUP" == "0" ]] && log "  $i. cleanup: node scripts/cleanup-stale-test-dbs.mjs --apply"
  [[ "$SKIP_CLEANUP" == "1" ]] && log "  $i. cleanup: skipped"
  exit 0
fi

if [[ "$SKIP_SETUP" == "0" ]]; then
  log "Step 1: staging setup (migrations + RLS + auth verify)"
  node "$REPO_ROOT/scripts/devops/setup-supabase.mjs" "${SETUP_ARGS[@]}"
else
  log "Step 1: setup skipped (--skip-setup)"
fi

log "Step 2: user-journey suites ($SUITE) against staging"
cd "$WEB_DIR"
for cmd in "${SUITE_CMDS[@]}"; do
  # shellcheck disable=SC2086
  log "Running: $cmd"
  $cmd
done

if [[ "$SKIP_CLEANUP" == "0" ]]; then
  log "Step 3: stale test-database cleanup"
  node "$WEB_DIR/scripts/cleanup-stale-test-dbs.mjs" --apply
else
  log "Step 3: cleanup skipped (--skip-cleanup)"
fi

log "Staging journey complete."
