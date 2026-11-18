/**
 * ==============================================================================
 * CafeMood Supabase Auth Verification Suite
 * Architecture: docs/specs/0001-nextjs-migration.md §Auth
 * Decision:     docs/adr/0010-self-hosted-postgres-supabase-auth.md
 *
 * Supabase keeps Auth only (ADR-0010). Application data lives in the Dokploy
 * Postgres service for the environment, and its schema is owned by
 * `web/scripts/migrate.mjs` — this suite never touches application tables:
 *   1. Validates Auth credentials (SUPABASE_URL, service role key, publishable key)
 *   2. Verifies Supabase Auth endpoints, session handling, and OAuth redirect flow
 *
 * Usage:
 *   node scripts/devops/setup-supabase.mjs [options]
 *
 * Options:
 *   -h, --help                Show this help message and exit
 *   --supabase-url <url>      Supabase Project API URL (https://<ref>.supabase.co)
 *   --service-role-key <key>  Supabase service_role secret key
 *   --anon-key <key>          Supabase publishable public key (sb_publishable_…; flag keeps legacy name)
 *   --env-file <path>         Path to custom .env file to load
 *   --dry-run                 Log planned actions without modifying state
 *   --verify-only             Read-only verification (no mutations either way)
 *   --skip-auth               Skip Supabase Auth connectivity tests
 *   --verbose                 Enable detailed logging
 *
 * Decomposition (BRAWUKA-745): this file stays the stable executable — CLI
 * surface (help, exit codes), logging, and dependency resolution from
 * `web/package.json` — and orchestrates two concrete operations plus their
 * config resolution:
 *   lib/setup-supabase-config.mjs  flags/env/files → resolved config
 *   lib/setup-supabase-auth.mjs    Auth verification
 * ==============================================================================
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifySupabaseAuth } from "./lib/setup-supabase-auth.mjs";
import { parseCliArgs } from "./lib/setup-supabase-config.mjs";

// ------------------------------------------------------------------------------
// Path & Module Resolution
// ------------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const WEB_DIR = path.join(REPO_ROOT, "web");
const WEB_PKG = path.join(WEB_DIR, "package.json");

const req = createRequire(WEB_PKG);
const { createClient } = req("@supabase/supabase-js");

// ------------------------------------------------------------------------------
// Formatting & Colors
// ------------------------------------------------------------------------------
const isTTY = Boolean(process.stdout.isTTY);
const color = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  red: isTTY ? "\x1b[31m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  gray: isTTY ? "\x1b[90m" : "",
};

const log = {
  info: (msg) => console.log(`${color.cyan}[INFO]${color.reset} ${msg}`),
  step: (num, title) => console.log(`\n${color.bold}${color.cyan}[Step ${num}]${color.reset} ${color.bold}${title}${color.reset}`),
  success: (msg) => console.log(`${color.green}[PASS]${color.reset} ${msg}`),
  warn: (msg) => console.log(`${color.yellow}[WARN]${color.reset} ${msg}`),
  error: (msg) => console.error(`${color.red}[FAIL]${color.reset} ${msg}`),
  dim: (msg) => console.log(`${color.gray}       ${msg}${color.reset}`),
};

// ------------------------------------------------------------------------------
// CLI Surface
// ------------------------------------------------------------------------------
function showHelp() {
  console.log(`
CafeMood Supabase Auth Verification Suite

Application data lives in the environment's Dokploy Postgres (ADR-0010); its
schema is applied by web/scripts/migrate.mjs. This suite verifies Auth only.

Usage:
  node scripts/devops/setup-supabase.mjs [options]
  ./scripts/devops/provision-supabase.sh [options]

Options:
  -h, --help                Show this help message and exit
  --supabase-url <url>      Supabase API URL (https://<project-ref>.supabase.co)
  --service-role-key <key>  Supabase service_role secret key
  --anon-key <key>          Supabase publishable public key (sb_publishable_…; flag keeps legacy name)
  --env-file <path>         Path to custom env file to load (default checks .env, web/.env.local)
  --dry-run                 Log planned actions without modifying system state
  --verify-only             Run verification checks only (no DDL migrations or revocations)
  --skip-auth               Skip Supabase Auth endpoint & OAuth smoke test
  --verbose                 Show detailed database and network logs

Environment Variables (fallback):
  SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SECRET_KEY (legacy SUPABASE_SERVICE_ROLE_KEY)
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY
    (legacy NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY)
`);
  process.exit(0);
}

function maskString(str, visibleChars = 8) {
  if (!str) return "<none>";
  if (str.length <= visibleChars) return "***";
  return `${str.slice(0, visibleChars)}...${str.slice(-4)}`;
}

// ------------------------------------------------------------------------------
// Main Orchestration Flow
// ------------------------------------------------------------------------------
async function main() {
  console.log(`${color.bold}==============================================================${color.reset}`);
  console.log(`${color.bold}  CafeMood Supabase Auth Verification Suite                 ${color.reset}`);
  console.log(`${color.bold}==============================================================${color.reset}`);

  const parsed = parseCliArgs(process.argv.slice(2), { repoRoot: REPO_ROOT, webDir: WEB_DIR });
  if (parsed.kind === "help") showHelp();
  if (parsed.kind === "unknown-option") {
    console.error(`Unknown option: ${parsed.arg}`);
    process.exit(1);
  }
  const config = parsed.config;

  // ----------------------------------------------------------------------------
  // Step 1: Validate Environment & Credentials
  // ----------------------------------------------------------------------------
  log.step(1, "Validating Environment & Credentials");
  log.info(`Target Mode: ${config.verifyOnly ? "VERIFY ONLY" : config.dryRun ? "DRY RUN" : "VERIFY"}`);

  if (config.supabaseUrl) {
    try {
      const parsedUrl = new URL(config.supabaseUrl);
      log.success(`Supabase Project URL: ${parsedUrl.origin}`);
    } catch {
      log.error("SUPABASE_URL is not a valid URL format");
      process.exit(1);
    }
  } else {
    log.warn("SUPABASE_URL is not set. Auth verification will be skipped.");
    log.dim("Pass via --supabase-url or export SUPABASE_URL='https://[project-ref].supabase.co'");
  }

  if (config.serviceRoleKey) {
    log.success(`Service Role Key: present (${maskString(config.serviceRoleKey)})`);
  } else {
    log.dim("Service Role Key: not provided (optional for auth smoke check)");
  }

  if (config.anonKey) {
    log.success(`Publishable Public Key (anon): present (${maskString(config.anonKey)})`);
  } else {
    log.dim("Publishable Public Key (anon): not provided (optional for auth smoke check)");
  }

  // ----------------------------------------------------------------------------
  // Step 2: Supabase Auth Health & Connectivity Verification
  // ----------------------------------------------------------------------------
  await verifySupabaseAuth({ createClient, config, log });

  console.log(`\n${color.bold}${color.green}==============================================================${color.reset}`);
  console.log(`${color.bold}${color.green}  Supabase Auth Verification Finished Successfully             ${color.reset}`);
  console.log(`${color.bold}${color.green}==============================================================${color.reset}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((err) => {
    log.error(`Execution halted due to error: ${err.message}`);
    if (process.env.DEBUG || process.argv.includes("--verbose")) {
      console.error(err);
    }
    process.exit(1);
  });
}
