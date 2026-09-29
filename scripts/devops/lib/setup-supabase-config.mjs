/**
 * Argument & environment resolution for the Supabase provisioning suite
 * (BRAWUKA-745 decomposition; executable: `scripts/devops/setup-supabase.mjs`).
 *
 * One decision has one owner: this module decides *what* the run was asked to
 * do — flags, env files, environment variables, and their precedence — and
 * returns the resolved config. The executable owns the CLI surface: help text,
 * `process.exit` codes, and every rendered line. `parseCliArgs` therefore never
 * exits and never writes; `-h/--help` and an unknown flag come back as a result
 * the caller renders, so precedence is testable without spawning the CLI
 * (BRAWUKA-745 acceptance: "tests can import pure helpers without executing the
 * CLI", behaviour identical to the pre-decomposition executable).
 *
 * Precedence (unchanged since the executable owned this code): an explicit CLI
 * flag wins over `env` wins over the loaded env files. Env-file candidates are
 * `--env-file <path>` when given, otherwise `<repoRoot>/.env`,
 * `<webDir>/.env.local`, `<webDir>/.env`, assigned in that order so a later file
 * overrides an earlier one.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Parse a dotenv-style file into a plain object. Missing files resolve to `{}`;
 * blank lines, `#` comments, and lines without `=` are skipped; a fully quoted
 * value has its quotes stripped. No interpolation, by design.
 *
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/**
 * Resolve the provisioning run's configuration.
 *
 * @param {string[]} argv CLI arguments after the script path (`process.argv.slice(2)`).
 * @param {{ repoRoot: string, webDir: string, env?: Record<string, string | undefined> }} options
 *   `repoRoot`/`webDir` locate the candidate env files (`web/` is the package the
 *   executable resolves the run's dependencies from); `env` is the process
 *   environment, injectable so a test can prove precedence deterministically.
 * @returns {{ kind: "help" }
 *   | { kind: "unknown-option", arg: string }
 *   | { kind: "config", config: { databaseUrl: string, supabaseUrl: string, serviceRoleKey: string, anonKey: string, dryRun: boolean, verifyOnly: boolean, skipAuth: boolean, verbose: boolean } }}
 *   The caller renders `help` / `unknown-option` and exits with the code the
 *   pre-decomposition executable used (0 / 1).
 */
export function parseCliArgs(argv, { repoRoot, webDir, env = process.env }) {
  const options = {
    databaseUrl: "",
    supabaseUrl: "",
    serviceRoleKey: "",
    anonKey: "",
    envFile: "",
    dryRun: false,
    verifyOnly: false,
    skipAuth: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        return { kind: "help" };
      case "--database-url":
        options.databaseUrl = argv[++i];
        break;
      case "--supabase-url":
        options.supabaseUrl = argv[++i];
        break;
      case "--service-role-key":
        options.serviceRoleKey = argv[++i];
        break;
      case "--anon-key":
        options.anonKey = argv[++i];
        break;
      case "--env-file":
        options.envFile = argv[++i];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verify-only":
        options.verifyOnly = true;
        break;
      case "--skip-auth":
        options.skipAuth = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        return { kind: "unknown-option", arg };
    }
  }

  // Load from candidate env files if not set
  const candidateFiles = options.envFile
    ? [options.envFile]
    : [
        path.join(repoRoot, ".env"),
        path.join(webDir, ".env.local"),
        path.join(webDir, ".env"),
      ];

  const loadedEnv = {};
  for (const file of candidateFiles) {
    if (existsSync(file)) {
      Object.assign(loadedEnv, parseEnvFile(file));
    }
  }

  const getVal = (cliVal, envKeys) => {
    if (cliVal && cliVal.trim()) return cliVal.trim();
    for (const k of envKeys) {
      if (env[k]?.trim()) return env[k].trim();
      if (loadedEnv[k]?.trim()) return loadedEnv[k].trim();
    }
    return "";
  };

  return {
    kind: "config",
    config: {
      databaseUrl: getVal(options.databaseUrl, [
        "DATABASE_URL",
        "SUPABASE_DATABASE_URL",
        "POSTGRES_URL",
      ]),
      supabaseUrl: getVal(options.supabaseUrl, [
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
      ]),
      serviceRoleKey: getVal(options.serviceRoleKey, [
        "SUPABASE_SERVICE_ROLE_KEY",
      ]),
      anonKey: getVal(options.anonKey, [
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_ANON_KEY",
      ]),
      dryRun: options.dryRun,
      verifyOnly: options.verifyOnly,
      skipAuth: options.skipAuth,
      verbose: options.verbose,
    },
  };
}
