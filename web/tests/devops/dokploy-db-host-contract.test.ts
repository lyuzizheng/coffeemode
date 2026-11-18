import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BRAWUKA-1012: application data lives in the environment's Dokploy Postgres
 * (ADR-0010 §1-2); Supabase keeps Auth only. This suite is the regression gate
 * for the two Dokploy env templates.
 *
 * The gate validates the connection `pg` will actually open, not the authority
 * as written. `pg-connection-string` lets `?host=` / `?port=` override the
 * authority, percent-decodes the hostname, and DNS ignores case and a trailing
 * dot. A second assignment is just as effective: Docker Compose keeps the last
 * one. Each was a way for a hosted database to pass a naive authority check, so
 * the gate rejects all of them and then requires exactly one assignment per
 * variable, the internal service on :5432, a single explicit `sslmode=disable`,
 * and no other query parameter.
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

const DATABASE_VARS = ["DATABASE_URL", "DIRECT_URL"] as const;

/** Provider domains that only ever serve a hosted database in these templates. */
const HOSTED_DATABASE_DOMAINS = ["supabase.co", "supabase.net", "supabase.com"];

/** One database URL, built around the subject under test. */
function databaseUrl(host: string, query = "?sslmode=disable"): string {
  return `postgresql://coffeemode:stub@${host}:5432/coffeemode${query}`;
}

/**
 * Every active assignment of `key`, in file order. Docker Compose keeps the
 * last one, so the gate must see all of them: a duplicate is how a hosted URL
 * hides behind a valid line. `export` and spaces around `=` are accepted
 * because the compose dotenv reader accepts them.
 */
function envAssignments(content: string, key: string): string[] {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`, "gm");
  return Array.from(content.matchAll(pattern), ([, value]) =>
    value.trim().replace(/^["']|["']$/g, ""),
  );
}

function singleEnvValue(content: string, key: string, env: string): string {
  const values = envAssignments(content, key);
  if (values.length !== 1) {
    throw new Error(`${env} template must define ${key} exactly once (found ${values.length})`);
  }
  return values[0];
}

/** Exact domain or a real subdomain; `db.supabase.co.evil.example` is not one. */
function isHostedDatabaseHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return HOSTED_DATABASE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * The gate. Throws (never returns a boolean) so a mutant template fails the
 * suite with the offending variable named.
 */
function assertLocalDatabaseTargets(content: string, env: string): void {
  for (const key of DATABASE_VARS) {
    // `<...>` is resolved by Dokploy env at deploy time; the sentinel keeps the
    // URL parseable. Any other spelling passes through untouched.
    const url = new URL(
      singleEnvValue(content, key, env).replace(/<([A-Za-z0-9_-]+)>/g, "$1.internal.invalid"),
    );

    expect(["postgres:", "postgresql:"], `${env} ${key} must be a Postgres URL`).toContain(
      url.protocol,
    );

    // `pg` resolves `host`/`port` from the query after the authority, so any
    // other parameter is either such an override or an option this template
    // has no reason to carry.
    const extra = [...url.searchParams.keys()].filter((name) => name !== "sslmode");
    expect(
      extra,
      `${env} ${key} must not override the connection through query parameters`,
    ).toEqual([]);

    if (url.searchParams.getAll("sslmode").length !== 1) {
      throw new Error(`${env} ${key} must state sslmode=disable exactly once`);
    }
    expect(
      url.searchParams.get("sslmode"),
      `${env} ${key} must state sslmode=disable explicitly (ADR-0010 §2)`,
    ).toBe("disable");

    // What `pg` resolves: the override when one survives (it cannot, above),
    // otherwise the authority, percent-decoded. DNS ignores case and one
    // trailing dot, so both are normalized before the provider check.
    let resolvedHost: string;
    try {
      resolvedHost = decodeURIComponent(url.searchParams.get("host") ?? url.hostname);
    } catch {
      throw new Error(`${env} ${key} has a hostname that cannot be decoded`);
    }
    expect(
      isHostedDatabaseHost(resolvedHost),
      `${env} ${key} must not target a hosted Supabase database host`,
    ).toBe(false);
    expect(
      (url.searchParams.get("port") ?? url.port) || "5432",
      `${env} ${key} must use the internal Postgres port 5432`,
    ).toBe("5432");
  }
}

function withDatabaseUrl(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=).*$`, "m");
  return content.replace(pattern, `$1${value}`);
}

const HOSTED_REGRESSIONS: ReadonlyArray<[string, string, string]> = [
  [
    "direct Supabase project host",
    "DATABASE_URL",
    databaseUrl("db.example-ref.supabase.co"),
  ],
  [
    "transaction pooler",
    "DATABASE_URL",
    databaseUrl("aws-0-ap-southeast-1.pooler.supabase.com"),
  ],
  [
    "session pooler",
    "DIRECT_URL",
    databaseUrl("aws-0-ap-southeast-1.pooler.supabase.com"),
  ],
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

  it.each(TEMPLATES)("$env template rejects a duplicate assignment for each database variable", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      // Docker Compose keeps the last line, so this is the value that ships.
      const mutated = `${tracked}\n${key}=${databaseUrl("db.evil.supabase.co")}\n`;
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
