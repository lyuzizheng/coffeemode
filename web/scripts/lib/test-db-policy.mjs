/**
 * Test-database target-safety policy (BRAWUKA-742).
 *
 * Three test-tooling entry points can touch a database — the fixture seeders,
 * the integration harness, and the orphan sweeper — and each used to carry its
 * own copy of these rules. The copies had drifted apart in three ways: the
 * TypeScript guard took a database NAME where the script guard took a URL; the
 * TypeScript URL adapter threw on a malformed connection string where the script
 * one returned an empty name; and only the TypeScript guard refused
 * `host`/`hostaddr`/`socketPath` query overrides, so the sweepers would connect
 * to a host their connection string never named. This module is the single
 * decision point for all of it, with the URL/name split kept explicit
 * (`connectionTargetUrl` / `databaseNameFromUrl` adapt, the caller decides
 * whether a refusal is a thrown error or an exit).
 *
 * Three rules, deliberately separate questions:
 *   1. `assertSafeSeedTarget` — may a deterministic fixture seeder write here?
 *   2. `evaluateRemoteTarget` — may this process connect to that host at all?
 *   3. `isTestDatabaseName`   — may the orphan sweeper drop that database?
 *
 * Rule 3 is not a precondition of rule 1: a seed target only has to avoid the
 * dev database, and requiring the sweeper's cleanup pattern would refuse
 * legitimate seeded databases the sweeper never drops.
 *
 * Caller-by-caller expected behavior (each caller adapts its own input and
 * decides how a refusal surfaces; the verdict itself comes from here):
 *
 * | Caller                                        | Input it holds           | Refusal |
 * | --------------------------------------------- | ------------------------ | ------- |
 * | `tests/helpers/db.ts:assertSafeSeedClient`    | name from the server     | throws  |
 * | `scripts/lib/e2e-fixtures.mjs`                | connection URL (adapted) | throws  |
 * | `tests/helpers/db.ts:integrationAdminUrl`     | `DATABASE_URL`           | throws  |
 * | `scripts/cleanup-stale-test-dbs.mjs`          | `--database-url` / env   | exit 1  |
 * | `scripts/clean-dev-fixtures.mjs`              | `--database-url` / env   | exit 1  |
 *
 * Plain ESM with JSDoc types and no imports so every runtime loads it without a
 * build step: `web/tests/helpers/db.ts` (Vitest, TypeScript) and the `node`
 * CLIs under `web/scripts/` (shipped verbatim into the standalone image). This
 * is test-tooling policy, not an application contract — production code under
 * `app/` and `lib/` MUST NOT import it.
 */

/** Opt-in that disables the dev-database refusal (BRAWUKA-216). */
export const SEED_DEV_DB_OPT_IN = "ALLOW_SEED_DEV_DB";
/** Opt-in required before any test tool connects to a non-local host. */
export const REMOTE_DB_OPT_IN = "ALLOW_REMOTE_INTEGRATION_DB";
export const DEFAULT_DB_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
/** Documented local dev database: docker compose + every script default. Never a seed target. */
export const DEV_DATABASE_NAME = "coffeemode";

/**
 * Hostnames that mean "this machine": docker compose, a CI service container,
 * and the staging runner kit. An empty hostname is libpq's local-socket default.
 *
 * @type {Record<string, true>}
 */
const LOCAL_DB_HOSTS = { localhost: true, "127.0.0.1": true, "::1": true, "[::1]": true };

/**
 * libpq keywords `pg-connection-string` honours from the URL query string and
 * lets win over the URL's own authority, so the visible hostname is not the host
 * that would be dialled.
 */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr", "socketPath"];

/**
 * Strict URL adapter. A malformed connection string throws here; it never
 * degrades to a default, because every caller is deciding whether to touch a
 * database. The message names no credentials.
 *
 * @param {string} raw
 * @returns {URL}
 */
export function connectionTargetUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    throw new Error("Unreadable database connection string: not a valid URL.");
  }
}

/**
 * Database name from a connection string's path segment (never the whole URL).
 * Strict for the same reason as `connectionTargetUrl`: a guard that read a
 * parse failure as an empty name would be one comparison away from allowing the
 * write it exists to refuse.
 *
 * @param {string} raw
 * @returns {string} the decoded path segment, or "" when the URL has no path.
 */
export function databaseNameFromUrl(raw) {
  const url = connectionTargetUrl(raw);
  try {
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error(
      "Unreadable database connection string: invalid escape sequence in the database name.",
    );
  }
}

/**
 * Name of the configured dev database: `configUrl`, else `DATABASE_URL`, else the
 * documented local default. Journey suites overwrite `DATABASE_URL` with the
 * scratch-database URL before seeding, which is why callers that hold the
 * pre-overwrite admin URL pass it explicitly.
 *
 * @param {string} [configUrl]
 * @returns {string}
 */
export function configuredDevDatabaseName(configUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL) {
  return databaseNameFromUrl(configUrl);
}

/**
 * Pure inspection of a connection target, without reading any opt-in.
 *
 * @param {string} raw
 * @returns {{ url: URL, hostname: string, overrideParam: string | null, isLocalHost: boolean }}
 */
function inspectConnectionTarget(raw) {
  const url = connectionTargetUrl(raw);
  const hostname = url.hostname;
  return {
    url,
    hostname,
    overrideParam: HOST_OVERRIDE_PARAMS.find((name) => url.searchParams.has(name)) ?? null,
    isLocalHost: hostname === "" || Object.hasOwn(LOCAL_DB_HOSTS, hostname),
  };
}

/**
 * May this process connect to `raw`? By default a target is acceptable only when
 * it names a local host AND carries none of the connection-string overrides that
 * would redirect it. The sweeper scripts adopt that stricter rule here; they used
 * to check the hostname alone, so `?host=<elsewhere>` looked local.
 *
 * `ALLOW_REMOTE_INTEGRATION_DB=1` is the single opt-in for the whole question: it
 * lifts the override refusal exactly as it already lifted the non-local-host one
 * in `integrationAdminUrl`, because both mean "this explicitly disposable
 * server". It is not a per-parameter switch and it does not cover an unreadable
 * connection string: the URL is parsed before the opt-in is read, so a malformed
 * string is a refusal either way.
 *
 * @param {string} raw
 * @param {{ action?: string }} [options] Verb phrase named in the refusal, e.g.
 *   "stale-DB sweep". Callers state their own action so one rule still reports
 *   which operation it stopped.
 * @returns {{ url: URL, hostname: string, overrideParam: string | null, isLocalHost: boolean, refusal: string | null }}
 *   `refusal` is the operator-facing text, or null when the target is allowed.
 */
export function evaluateRemoteTarget(raw, { action = "test tooling" } = {}) {
  const target = inspectConnectionTarget(raw);
  if (process.env[REMOTE_DB_OPT_IN] === "1") return { ...target, refusal: null };
  if (target.overrideParam === null && target.isLocalHost) return { ...target, refusal: null };
  const host = target.hostname || "(empty)";
  const described =
    target.overrideParam === null
      ? `non-local host ${host}`
      : `connection-string override "${target.overrideParam}" (host ${host})`;
  return {
    ...target,
    refusal:
      `Refusing ${action} against ${described}; ` +
      `set ${REMOTE_DB_OPT_IN}=1 only for an explicitly disposable test server`,
  };
}

/**
 * Fail-closed guard for deterministic fixture seeders (BRAWUKA-216): refuse to
 * write when the target database is the configured dev database, unless the
 * operator opts in with `ALLOW_SEED_DEV_DB=1`. The `coffeemode` name is always
 * protected, even when `DATABASE_URL` points somewhere else.
 *
 * `targetDbName` is an explicit database NAME — a caller holding a connection
 * string adapts it with `databaseNameFromUrl` first. The opt-in is read before
 * the configured URL is parsed: the operator has already accepted the write, and
 * a URL-holding caller has already parsed its target by then.
 *
 * @param {string} targetDbName
 * @param {{ seeder?: string, configUrl?: string }} [options] `configUrl` is the
 *   pre-overwrite admin URL for callers that replaced `DATABASE_URL`.
 * @returns {{ target: string, skipped: boolean }} The trimmed target name and
 *   whether the opt-in bypassed the refusal.
 */
export function assertSafeSeedTarget(targetDbName, { seeder = "seeder", configUrl } = {}) {
  const target = (targetDbName ?? "").trim();
  if (process.env[SEED_DEV_DB_OPT_IN] === "1") return { target, skipped: true };
  const configured =
    configUrl === undefined ? configuredDevDatabaseName() : databaseNameFromUrl(configUrl);
  if (target === "" || target === configured || target === DEV_DATABASE_NAME) {
    throw new Error(
      `Refusing ${seeder} against database "${target || "(unknown)"}": fixture seeders only write test databases ` +
        `(configured dev database is "${configured}"). Set ${SEED_DEV_DB_OPT_IN}=1 to override explicitly.`,
    );
  }
  return { target, skipped: false };
}

/**
 * Prefixes every provisioned scratch database starts with — `makeTestDbName`
 * callers in `web/tests/helpers/db.ts` plus the journey/HTTP suites. A new
 * scratch prefix must be added here or the sweeper will never drop its orphans.
 */
const TEST_DB_PREFIXES = ["coffeemode_", "supa_prov_test_"];
/** `{prefix}_{pid}_{uuid32}` — the pid+uuid suffix makes real databases unmatchable. */
const TEST_DB_NAME_PATTERN = /^[a-z0-9_]+_[0-9]+_[0-9a-f]{32}$/;

/**
 * Scratch-database eligibility for the orphan sweeper: may this name be dropped
 * when it has no backends? See the module header — this is not a seed-target
 * requirement.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isTestDatabaseName(name) {
  if (typeof name !== "string") return false;
  if (!TEST_DB_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  if (name.endsWith("_template")) return false;
  return TEST_DB_NAME_PATTERN.test(name);
}
