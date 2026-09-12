/**
 * Fail-closed guard for script-side fixture seeders (BRAWUKA-216).
 *
 * `web/scripts/lib/e2e-fixtures.mjs` (`setupDbFixtures`) defaults to the local
 * dev database, so a bare `npm run test:e2e` / `npm run lhci` writes
 * deterministic `e2e00000-*` rows into the same database `check:visual` reads.
 * This module refuses that unless the operator explicitly opts in with
 * `ALLOW_SEED_DEV_DB=1` — the same fail-closed posture as
 * `scripts/devops/run-staging-journey.sh` (STAGING_DATABASE_URL has no default)
 * and `integrationAdminUrl` in `web/tests/helpers/db.ts` (the logic here
 * mirrors `assertSafeSeedTarget` there; the two runtimes cannot share a module).
 *
 * The comparison is by database NAME (the connection-string path segment),
 * never the whole URL string, and the refusal names the actual target.
 */

export const SEED_DEV_DB_OPT_IN = "ALLOW_SEED_DEV_DB";
export const DEFAULT_DEV_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
/** Documented local dev database: docker compose + every script default. Never a seed target. */
export const DEV_DATABASE_NAME = "coffeemode";

export function databaseNameFromUrl(raw) {
  try {
    return decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

export function configuredDevDatabaseName(
  configUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL,
) {
  return databaseNameFromUrl(configUrl);
}

/**
 * Throw when `targetUrl` names the configured dev database (or the documented
 * `coffeemode` default, which stays protected even when DATABASE_URL points
 * elsewhere). Returns the resolved names so callers can log their real target.
 */
export function assertSafeSeedTarget(targetUrl, { seeder = "seeder", configUrl } = {}) {
  const target = databaseNameFromUrl(targetUrl);
  const configured = configUrl === undefined ? configuredDevDatabaseName() : databaseNameFromUrl(configUrl);
  if (process.env[SEED_DEV_DB_OPT_IN] === "1") return { target, configured, skipped: true };
  if (target === "" || target === configured || target === DEV_DATABASE_NAME) {
    throw new Error(
      `[seed-guard] Refusing ${seeder} against database "${target || "(unknown)"}": ` +
        `fixture seeders only write test databases (configured dev database is "${configured}"). ` +
        `Set ${SEED_DEV_DB_OPT_IN}=1 to override explicitly.`,
    );
  }
  return { target, configured, skipped: false };
}
