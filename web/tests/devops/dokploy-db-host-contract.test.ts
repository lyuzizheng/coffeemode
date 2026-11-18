import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATABASE_VARS,
  assertLocalDatabaseTargets,
  isHostedDatabaseHost,
  singleEnvValue,
} from "./lib/dokploy-db-env";

/**
 * BRAWUKA-1012: application data lives in the environment's Dokploy Postgres
 * (ADR-0010 §1-2); Supabase keeps Auth only. This suite is the regression gate
 * for the two Dokploy env templates.
 *
 * The gate itself (assignment forms, effective host/port, provider check) lives
 * in `lib/dokploy-db-env.ts`; this file is the case matrix. It covers both
 * templates, both database variables, and every regression the reviews found:
 * a hosted direct/pooler URL, a `?host=`/`?port=` override, a percent-encoded
 * parameter name, a repeated `sslmode`, an encoded or trailing-dot hosted
 * hostname, a duplicate assignment in either Compose spelling, an empty
 * authority host, and an omitted port.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is Auth, not database configuration: it stays a
 * Supabase URL and this gate deliberately ignores it. The concrete database
 * host is environment-supplied (BRAWUKA-1016), so the tracked templates keep a
 * `<...-db-host>` placeholder and the gate substitutes a sentinel before
 * parsing — a real host in Dokploy env goes through the same checks.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEPLOY = path.join(REPO_ROOT, "deploy/dokploy");

const TEMPLATES = [
  { env: "staging", file: path.join(DEPLOY, ".env.staging.example") },
  { env: "production", file: path.join(DEPLOY, ".env.prod.example") },
] as const;

/** One database URL, built around the subject under test. */
function databaseUrl(host: string, query = "?sslmode=disable"): string {
  return `postgresql://coffeemode:stub@${host}:5432/coffeemode${query}`;
}

function withDatabaseUrl(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*[=:]).*$`, "m");
  return content.replace(pattern, `$1 ${value}`);
}

const HOSTED_REGRESSIONS: ReadonlyArray<[string, string, string]> = [
  ["direct Supabase project host", "DATABASE_URL", databaseUrl("db.example-ref.supabase.co")],
  ["transaction pooler", "DATABASE_URL", databaseUrl("aws-0-ap-southeast-1.pooler.supabase.com")],
  ["session pooler", "DIRECT_URL", databaseUrl("aws-0-ap-southeast-1.pooler.supabase.com")],
  ["legacy supabase.net host", "DIRECT_URL", databaseUrl("db.example-ref.supabase.net")],
];

/** The host/port `pg` would use can be moved out of the authority. */
const OVERRIDE_QUERIES: ReadonlyArray<[string, string]> = [
  ["host override", "?sslmode=disable&host=db.evil.supabase.co"],
  ["port override", "?sslmode=disable&port=6543"],
  ["percent-encoded parameter name", "?sslmode=disable&%68ost=db.evil.supabase.co"],
  ["host and port override", "?sslmode=disable&host=db.evil.supabase.co&port=6543"],
];

/** Hostnames that resolve to a hosted target after pg's decoding. */
const NORMALIZED_HOSTED_HOSTS = [
  "db%2Eevil%2Esupabase%2Eco",
  "%64b.evil.supabase.co",
  "DB.EVIL.SUPABASE.CO.",
  "db.evil.supabase.co.",
];

describe("Dokploy env templates — local database targets", () => {
  it.each(TEMPLATES)("$env template keeps both database URLs on the local service", ({ env, file }) => {
    assertLocalDatabaseTargets(fs.readFileSync(file, "utf8"), env);
  });

  it.each(TEMPLATES)("$env template keeps the Auth URL on Supabase", ({ env, file }) => {
    // Auth is the one legitimate Supabase URL in these files. If the gate ever
    // starts rejecting `NEXT_PUBLIC_SUPABASE_URL`, this fails together with it.
    const authUrl = singleEnvValue(fs.readFileSync(file, "utf8"), "NEXT_PUBLIC_SUPABASE_URL", env);
    const parsed = new URL(authUrl);
    expect(parsed.protocol).toBe("https:");
    expect(isHostedDatabaseHost(parsed.hostname)).toBe(true);
  });

  it.each(TEMPLATES)("$env template rejects a hosted database regression", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const [label, key, url] of HOSTED_REGRESSIONS) {
      const mutated = withDatabaseUrl(tracked, key, url);
      expect(mutated, `${label}: mutation did not apply`).not.toBe(tracked);
      expect(
        () => assertLocalDatabaseTargets(mutated, env),
        `${label} must fail the ${env} gate`,
      ).toThrow(new RegExp(`${key} must not target a hosted Supabase database host`));
    }
  });

  it.each(TEMPLATES)("$env template rejects host and port overrides for each database variable", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      for (const [label, query] of OVERRIDE_QUERIES) {
        const mutated = withDatabaseUrl(tracked, key, databaseUrl("localhost", query));
        expect(
          () => assertLocalDatabaseTargets(mutated, env),
          `${label} on ${env} ${key} must fail the gate`,
        ).toThrow(/must not override the connection through query parameters/);
      }
    }
  });

  it.each(TEMPLATES)("$env template rejects a repeated sslmode for each database variable", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      // `pg` takes the last one; a first-match reader would see `disable`.
      const mutated = withDatabaseUrl(
        tracked,
        key,
        databaseUrl("localhost", "?sslmode=disable&sslmode=require"),
      );
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(
        /must state sslmode=disable exactly once/,
      );
    }
  });

  it.each(TEMPLATES)("$env template rejects encoded and normalized hosted hostnames", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      for (const host of NORMALIZED_HOSTED_HOSTS) {
        const mutated = withDatabaseUrl(tracked, key, databaseUrl(host));
        expect(
          () => assertLocalDatabaseTargets(mutated, env),
          `${host} on ${env} ${key} must fail the gate`,
        ).toThrow(new RegExp(`${key} must not target a hosted Supabase database host`));
      }
    }
  });

  it.each(TEMPLATES)("$env template rejects an `=` duplicate for each database variable", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      // Docker Compose keeps the last line, so this is the value that ships.
      const mutated = `${tracked}\n${key}=${databaseUrl("db.evil.supabase.co")}\n`;
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(
        new RegExp(`${env} template must define ${key} exactly once`),
      );
    }
  });

  it.each(TEMPLATES)("$env template rejects a `:` duplicate for each database variable", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      // Compose's env-file reader accepts the colon spelling and keeps the last.
      const mutated = `${tracked}\n${key}: ${databaseUrl("db.evil.supabase.co")}\n`;
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(
        new RegExp(`${env} template must define ${key} exactly once`),
      );
    }
  });

  it.each(TEMPLATES)("$env template rejects an exported duplicate assignment", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    const mutated = `${tracked}\nexport DATABASE_URL=${databaseUrl("db.evil.supabase.co")}\n`;
    expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(
      /must define DATABASE_URL exactly once/,
    );
  });

  it.each(TEMPLATES)("$env template rejects an empty authority host", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      // No authority: `pg` would fall back to PGHOST.
      const mutated = withDatabaseUrl(tracked, key, "postgresql:///coffeemode?sslmode=disable");
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(
        new RegExp(`${key} must name a host`),
      );
    }
  });

  it.each(TEMPLATES)("$env template rejects an omitted port", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      // No port: `pg` would fall back to PGPORT, which the container controls.
      const mutated = withDatabaseUrl(
        tracked,
        key,
        "postgresql://coffeemode:stub@db.internal/coffeemode?sslmode=disable",
      );
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(
        new RegExp(`${key} must state port 5432 explicitly`),
      );
    }
  });

  it("rejects a hosted Auth host reused as the database URL", () => {
    // The Auth URL is legitimate; copying it into DATABASE_URL is not.
    const prod = fs.readFileSync(path.join(DEPLOY, ".env.prod.example"), "utf8");
    const authUrl = singleEnvValue(prod, "NEXT_PUBLIC_SUPABASE_URL", "production");
    const hosted = new URL(authUrl).hostname.replace(/^/, "db.");
    const mutated = withDatabaseUrl(prod, "DATABASE_URL", databaseUrl(hosted));
    expect(() => assertLocalDatabaseTargets(mutated, "production")).toThrow(/hosted Supabase/);
  });

  it("does not over-match lookalike hosts", () => {
    const prod = fs.readFileSync(path.join(DEPLOY, ".env.prod.example"), "utf8");
    for (const host of ["db.xsupabase.co", "db-supabase.internal.example", "db.supabase.co.evil.example"]) {
      const mutated = withDatabaseUrl(prod, "DATABASE_URL", databaseUrl(host));
      expect(() => assertLocalDatabaseTargets(mutated, "production")).not.toThrow();
    }
  });

  it.each(TEMPLATES)("$env template requires an explicit sslmode", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      const mutated = withDatabaseUrl(tracked, key, "postgresql://coffeemode:stub@<db-host>:5432/coffeemode");
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(/sslmode=disable/);
    }
  });
});
