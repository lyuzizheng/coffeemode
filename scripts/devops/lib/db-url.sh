#!/usr/bin/env bash
# ==============================================================================
# Shared environment-scoped database URL selection (BRAWUKA-747)
#
# Sourced by the lifecycle entrypoints that need a Postgres connection string —
# backup.sh, restore.sh, upgrade-prod.sh, upgrade-staging.sh. Each entrypoint
# keeps its own lifecycle state, archives, confirmation, drift probe, health
# checks and restore validation; only env-file value reading and scoped URL
# resolution live here (BRAWUKA-747).
#
# Precedence (frozen; policy BRAWUKA-241 P0):
#   1. explicit URL override (`--url` / `--db-url`) — opt-in escape hatch
#   2. <ENV>_DIRECT_URL          session/direct connection
#   3. <ENV>_DATABASE_URL        pooled — `pooled` scope only
#   4. deploy/dokploy/.env.<env> DIRECT_URL line first, then DATABASE_URL
#                                (`pooled` scope only)
# Scoped sources always rank above the environment file: a file DIRECT_URL must
# never outrank an exported scoped DATABASE_URL, and the explicit override
# outranks both. Unscoped ambient DATABASE_URL / DIRECT_URL are NEVER consulted,
# so the caller's shell cannot silently retarget a target environment.
# Migrations stay direct-only (`direct` scope): they never read a pooled URL,
# from an env var or from the environment file.
#
# Both functions print to stdout only on success. A resolution failure returns 1
# with no output, so no caller can echo credentials out of a failed lookup.
#
# bash 3.2 (macOS system bash) compatible: no namerefs, no associative arrays.
#
# Usage: source "${SCRIPT_DIR}/lib/db-url.sh"
# ==============================================================================

# The environment file lives in the checkout this helper ships in, so callers do
# not have to thread their own REPO_ROOT through the lookup.
DB_URL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_URL_ENV_DIR="${DB_URL_LIB_DIR}/../../../deploy/dokploy"

# db_url_env_file_value <KEY> <FILE>
# Print the first `KEY=` value in FILE with quotes stripped, or an empty string
# when the key or the file is absent. Quote handling is unchanged from the
# inline reads this extraction replaced — this is not a dotenv parser.
db_url_env_file_value() {
  local key="$1" file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo ""
}

# db_url_resolve <staging|prod> <override> <direct|pooled>
# Print the connection string for the target environment, or return 1 when no
# scoped source resolves. `pooled` additionally accepts <ENV>_DATABASE_URL and
# the environment file's DATABASE_URL line; `direct` refuses both.
db_url_resolve() {
  local target_env="$1" override_url="$2" scope="$3"
  if [[ "$target_env" != "staging" && "$target_env" != "prod" ]]; then
    return 1
  fi
  if [[ -n "$override_url" ]]; then
    printf '%s' "$override_url"
    return 0
  fi
  local prefix
  if [[ "$target_env" == "staging" ]]; then prefix="STAGING"; else prefix="PROD"; fi
  local direct_var="${prefix}_DIRECT_URL"
  if [[ -n "${!direct_var:-}" ]]; then
    printf '%s' "${!direct_var}"
    return 0
  fi
  if [[ "$scope" == "pooled" ]]; then
    local pooled_var="${prefix}_DATABASE_URL"
    if [[ -n "${!pooled_var:-}" ]]; then
      printf '%s' "${!pooled_var}"
      return 0
    fi
  fi
  local env_file="${DB_URL_ENV_DIR}/.env.${target_env}"
  local url
  url="$(db_url_env_file_value DIRECT_URL "$env_file")"
  if [[ -z "$url" && "$scope" == "pooled" ]]; then
    url="$(db_url_env_file_value DATABASE_URL "$env_file")"
  fi
  if [[ -n "$url" ]]; then
    printf '%s' "$url"
    return 0
  fi
  return 1
}
