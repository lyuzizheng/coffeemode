#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Supabase Production Provisioning Orchestrator
# Architecture: docs/specs/0001-nextjs-migration.md §Data layer
# Decisions:    docs/specs/0004-product-decisions-and-backlog.md (34a & 35)
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Orchestrates idempotent Supabase main Postgres & Auth provisioning:
#   1. Validates environment variables & credentials
#   2. Verifies Node.js runtime and web workspace dependencies
#   3. Executes setup-supabase.mjs for schema, PostGIS, RLS, & Auth tests
#
# Usage:
#   ./provision-supabase.sh [options]
#
# Options:
#   -h, --help                Show this help message and exit
#   --database-url <url>      PostgreSQL connection string (supports direct & pooler URLs)
#   --supabase-url <url>      Supabase API URL (https://<project-ref>.supabase.co)
#   --service-role-key <key>  Supabase service_role secret key
#   --anon-key <key>          Supabase anon public key
#   --env-file <path>         Path to custom env file to load (default: checks .env, web/.env.local)
#   --dry-run                 Log planned actions without modifying system state
#   --verify-only             Run verification checks only (no DDL migrations or revocations)
#   --skip-auth               Skip Supabase Auth endpoint & OAuth smoke test
#   --verbose                 Show detailed database and network logs
#
# Examples:
#   ./provision-supabase.sh --database-url "postgres://..." --supabase-url "https://..."
#   ./provision-supabase.sh --verify-only
#   ./provision-supabase.sh --dry-run
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WEB_DIR="${REPO_ROOT}/web"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[FAIL]${NC} $1" >&2
}

show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

# Check for help flag early
for arg in "$@"; do
  if [[ "$arg" == "-h" || "$arg" == "--help" ]]; then
    show_help
  fi
done

# ------------------------------------------------------------------------------
# Pre-flight Runtime Checks
# ------------------------------------------------------------------------------
log_info "Verifying Node.js runtime environment..."
if ! command -v node >/dev/null 2>&1; then
  log_error "Node.js is not installed or not in PATH. Node.js >= 18 is required."
  exit 1
fi

NODE_VERSION="$(node -v | sed 's/^v//' | cut -d'.' -f1)"
if [[ "$NODE_VERSION" -lt 18 ]]; then
  log_error "Node.js version >= 18 required. Found $(node -v)."
  exit 1
fi
log_success "Node.js runtime verified: $(node -v)"

# Check if web/node_modules exists
if [[ ! -d "${WEB_DIR}/node_modules" ]]; then
  log_warn "Dependencies in ${WEB_DIR}/node_modules not found. Installing via npm ci..."
  (cd "${WEB_DIR}" && npm ci)
  log_success "Dependencies installed."
fi

# ------------------------------------------------------------------------------
# Execution
# ------------------------------------------------------------------------------
log_info "Delegating orchestration to setup-supabase.mjs..."
exec node "${SCRIPT_DIR}/setup-supabase.mjs" "$@"
