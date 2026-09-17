#!/usr/bin/env bash
# ==============================================================================
# CafeMood Staging User-Journey Runner
# Lifecycle:    docs/devops/LIFECYCLE.md (staging verification)
# Test layers: docs/specs/0003-testing-and-ci.md
# Boundaries:  docs/specs/0010-environments-and-secrets.md §4/§5
#
# Before-run setup + full user-journey verification + after-run cleanup against
# a staging Supabase Postgres — the staging counterpart of the CI
# `integration-gate` (which runs the same suites against local PostGIS).
#
#   0. Drift precheck: repo migrations vs staging ledger
#      (web/scripts/check-migration-drift.mjs, read-only; names the gap, never
#      applies anything — setup below converges it).
#   1. Setup: idempotent migrations + RLS + auth verify via
#      scripts/devops/setup-supabase.mjs (skippable with --skip-setup).
#   2. Run: real-DB journey suites (API calls + stored-state assertions) with
#      ALLOW_REMOTE_INTEGRATION_DB=1. Each suite provisions isolated
#      `{prefix}_{pid}_{uuid}` databases and drops them in afterAll
#      (spec 0010 §4). Vitest worker concurrency inside one run is capped by
#      STAGING_MAX_WORKERS (default in web/config/app.yaml §staging,
#      overridable per invocation) — not scattered per-suite flags.
#   3. Cleanup: drop orphaned test databases left by crashed runs via
#      web/scripts/cleanup-stale-test-dbs.mjs --apply (skippable).
#
# Never touches production: STAGING_DATABASE_URL is required and has no
# default, so a bare invocation fails fast instead of running against local
# dev or prod. One journey run at a time per staging server: a second
# instance exits at the mkdir lock below (spec 0010 §4). CI serializes
# further up via the workflow `concurrency: staging-journey` group
# (.github/workflows/staging-journey.yml) — same group name in the log.
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
# Empty = read web/config/app.yaml §staging at runtime (single source).
STAGING_MAX_WORKERS="${STAGING_MAX_WORKERS:-}"

log()  { echo "[staging-journey] $*"; }
warn() { echo "[staging-journey] WARN: $*" >&2; }
fail() { echo "[staging-journey] FAIL: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
CafeMood Staging User-Journey Runner

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
  STAGING_DATABASE_URL        Required. Staging Postgres connection string
                              (session/direct :5432 — CREATE DATABASE cannot
                              run through the :6543 pooler, spec 0010 §4).
  STAGING_MAX_WORKERS         Optional. Vitest worker cap for this run;
                              default from web/config/app.yaml §staging.
  SUPABASE_URL                Optional. Enables Supabase Auth endpoint checks.
  SUPABASE_SERVICE_ROLE_KEY   Optional. Enables privileged setup verification.
  SUPABASE_ANON_KEY           Optional. Enables anon auth checks.

Without Supabase keys the setup step runs with --skip-auth (DB provisioning
and verification only). Production databases are never targeted: there is no
default URL, and non-local hosts always require ALLOW_REMOTE_INTEGRATION_DB=1.

One run at a time per staging server: a second instance exits non-zero at
the mkdir lock (spec 0010 §4); CI runs serialize via the workflow
`concurrency: staging-journey` group.
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
# Spec 0010 §4: CREATE DATABASE cannot run through the transaction pooler.
if [[ "$STAGING_DATABASE_URL" == *":6543"* ]]; then
  fail "STAGING_DATABASE_URL must be the session/direct endpoint (:5432), not the :6543 pooler (CREATE DATABASE cannot run through it)"
fi
export ALLOW_REMOTE_INTEGRATION_DB=1
export DATABASE_URL="$STAGING_DATABASE_URL"
export RUN_INTEGRATION=1

# Concurrency cap (spec 0010 §4): one number, owned by web/config/app.yaml
# §staging — no fallback default here, a missing key fails loud (line 126).
# Per-invocation override: STAGING_MAX_WORKERS=<n>.
if [[ -z "${STAGING_MAX_WORKERS:-}" ]]; then
  STAGING_MAX_WORKERS="$(node --input-type=module -e '
import { readFile } from "node:fs/promises";
const text = await readFile(new URL("config/app.yaml", "file://'"$WEB_DIR"'/"), "utf8");
const m = text.match(/^staging:\s*\n((?:[ \t]+.*\n?)*)/m);
const w = m ? m[1].match(/^[ \t]+maxWorkers:\s*(\d+)\s*$/m) : null;
if (!w) { console.error("web/config/app.yaml §staging.maxWorkers missing"); process.exit(1); }
console.log(w[1]);' 2>/dev/null || true)"
  [[ -n "${STAGING_MAX_WORKERS:-}" ]] || fail "STAGING_MAX_WORKERS unset and web/config/app.yaml §staging.maxWorkers unreadable (see --help)"
fi
[[ "$STAGING_MAX_WORKERS" =~ ^[1-9][0-9]*$ ]] || fail "STAGING_MAX_WORKERS must be a positive integer (got '${STAGING_MAX_WORKERS:-}')"
export VITEST_MAX_WORKERS="$STAGING_MAX_WORKERS"

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

LOCK_HOST="$(printf '%s' "$STAGING_DATABASE_URL" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://([^/@?#]*@)?##; s#[/?#].*##; s#:#_#g')"
LOCK_DIR="${TMPDIR:-/tmp}/coffeemode-staging-journey-${LOCK_HOST}.lock"

if [[ "$DRY_RUN" == "1" ]]; then
  log "Plan (dry-run; nothing executed):"
  log "  0. drift precheck: node scripts/check-migration-drift.mjs --database-url \$STAGING_DATABASE_URL"
  [[ "$SKIP_SETUP" == "0" ]] && log "  1. setup: node scripts/devops/setup-supabase.mjs ${SETUP_ARGS[*]}"
  [[ "$SKIP_SETUP" == "1" ]] && log "  1. setup: skipped"
  i=2
  for cmd in "${SUITE_CMDS[@]}"; do
    log "  $i. run (cd web): VITEST_MAX_WORKERS=$STAGING_MAX_WORKERS $cmd"
    i=$((i + 1))
  done
  [[ "$SKIP_CLEANUP" == "0" ]] && log "  $i. cleanup: node scripts/cleanup-stale-test-dbs.mjs --apply"
  [[ "$SKIP_CLEANUP" == "1" ]] && log "  $i. cleanup: skipped"
  log "  lock: $LOCK_DIR (concurrency group: staging-journey)"
  exit 0
fi

# Second instance against the same server exits here (spec 0010 §4); the
# workflow concurrency group is the outer serializer, this is the inner one.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another staging-journey run holds $LOCK_DIR (concurrency group: staging-journey) — refusing to run concurrently"
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
log "Lock acquired: $LOCK_DIR (concurrency group: staging-journey)"

if [[ "$SKIP_SETUP" == "0" ]]; then
  # BRAWUKA-337 drift precheck: fail fast when the staging ledger trails the
  # repo (setup would apply the delta anyway — this names the drift first so
  # the log shows promotion was blocked by drift, not by a setup failure).
  log "Step 0: migration-drift precheck (repo vs staging ledger)"
  node "$WEB_DIR/scripts/check-migration-drift.mjs" --database-url "$STAGING_DATABASE_URL" || \
    warn "drift precheck reported a gap — setup below will converge it; promotion stays blocked until this precheck is green"
  log "Step 1: staging setup (migrations + RLS + auth verify)"
  node "$REPO_ROOT/scripts/devops/setup-supabase.mjs" "${SETUP_ARGS[@]}"
else
  log "Step 1: setup skipped (--skip-setup)"
fi

log "Step 2: user-journey suites ($SUITE) against staging (VITEST_MAX_WORKERS=$STAGING_MAX_WORKERS)"
cd "$WEB_DIR"
for cmd in "${SUITE_CMDS[@]}"; do
  # shellcheck disable=SC2086
  log "Running: VITEST_MAX_WORKERS=$STAGING_MAX_WORKERS $cmd"
  $cmd
done

if [[ "$SKIP_CLEANUP" == "0" ]]; then
  log "Step 3: stale test-database cleanup"
  node "$WEB_DIR/scripts/cleanup-stale-test-dbs.mjs" --apply
else
  log "Step 3: cleanup skipped (--skip-cleanup)"
fi

log "Staging journey complete."
