import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BRAWUKA-1012: application data lives in the environment's Dokploy Postgres
 * (ADR-0010 §1-2); Supabase keeps Auth only. This suite is the regression gate
 * for the two Dokploy env templates: `DATABASE_URL` and `DIRECT_URL` must name
 * the internal service on :5432 with an explicit non-TLS mode, and must never
 * name a hosted Supabase database host again.
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

/** Provider domains that only ever serve a hosted database here. */
const HOSTED_DATABASE_DOMAINS = ["supabase.co", "supabase.net", "supabase.com"];

/** Env assignments only: a commented `# DATABASE_URL=` line is documentation. */
function envValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : undefined;
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
    const value = envValue(content, key);
    expect(value, `${env} template must define ${key}`).toBeDefined();

    // `<...>` is resolved by Dokploy env at deploy time; substitute a sentinel
    // so the URL stays parseable. Any other spelling passes through untouched.
    const url = new URL((value ?? "").replace(/<([A-Za-z0-9_-]+)>/g, "$1.internal.invalid"));
    expect(["postgres:", "postgresql:"], `${env} ${key} must be a Postgres URL`).toContain(
      url.protocol,
    );
    expect(isHostedDatabaseHost(url.hostname), `${env} ${key} must not target a hosted Supabase database host`).toBe(
      false,
    );
    expect(url.port, `${env} ${key} must use the internal Postgres port 5432`).toBe("5432");
    expect(
      url.searchParams.get("sslmode"),
      `${env} ${key} must state sslmode=disable explicitly (ADR-0010 §2)`,
    ).toBe("disable");
  }
}

function withDatabaseUrl(content: string, key: string, value: string): string {
  return content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
}

const HOSTED_REGRESSIONS: ReadonlyArray<[string, string, string]> = [
  [
    "direct Supabase project host",
    "DATABASE_URL",
    "postgresql://coffeemode:stub@db.example-ref.supabase.co:5432/coffeemode?sslmode=require",
  ],
  [
    "transaction pooler",
    "DATABASE_URL",
    "postgresql://coffeemode:stub@aws-0-ap-southeast-1.pooler.supabase.com:6543/coffeemode?sslmode=require",
  ],
  [
    "session pooler",
    "DIRECT_URL",
    "postgresql://coffeemode:stub@aws-0-ap-southeast-1.pooler.supabase.com:5432/coffeemode?sslmode=require",
  ],
  [
    "legacy supabase.net host",
    "DIRECT_URL",
    "postgresql://coffeemode:stub@db.example-ref.supabase.net:5432/coffeemode?sslmode=require",
  ],
];

describe("Dokploy env templates — local database targets", () => {
  it.each(TEMPLATES)("$env template keeps both database URLs on the local service", ({ env, file }) => {
    assertLocalDatabaseTargets(fs.readFileSync(file, "utf8"), env);
  });

  it.each(TEMPLATES)("$env template keeps the Auth URL on Supabase", ({ file }) => {
    // Auth is the one legitimate Supabase URL in these files. If the gate ever
    // starts rejecting `NEXT_PUBLIC_SUPABASE_URL`, this fails together with it.
    const authUrl = envValue(fs.readFileSync(file, "utf8"), "NEXT_PUBLIC_SUPABASE_URL");
    expect(authUrl, "NEXT_PUBLIC_SUPABASE_URL is the Auth URL and must stay present").toBeDefined();
    const parsed = new URL(authUrl ?? "");
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

  it("rejects a hosted Auth host reused as the database URL", () => {
    // The Auth URL is legitimate; copying it into DATABASE_URL is not.
    const prod = fs.readFileSync(path.join(DEPLOY, ".env.prod.example"), "utf8");
    const authUrl = envValue(prod, "NEXT_PUBLIC_SUPABASE_URL") ?? "";
    const hosted = new URL(authUrl).hostname.replace(/^/, "db.");
    const mutated = withDatabaseUrl(
      prod,
      "DATABASE_URL",
      `postgresql://coffeemode:stub@${hosted}:5432/coffeemode?sslmode=disable`,
    );
    expect(() => assertLocalDatabaseTargets(mutated, "production")).toThrow(/hosted Supabase/);
  });

  it("does not over-match lookalike hosts", () => {
    const prod = fs.readFileSync(path.join(DEPLOY, ".env.prod.example"), "utf8");
    for (const host of ["db.xsupabase.co", "db-supabase.internal.example", "db.supabase.co.evil.example"]) {
      const mutated = withDatabaseUrl(
        prod,
        "DATABASE_URL",
        `postgresql://coffeemode:stub@${host}:5432/coffeemode?sslmode=disable`,
      );
      expect(() => assertLocalDatabaseTargets(mutated, "production")).not.toThrow();
    }
  });

  it.each(TEMPLATES)("$env template requires an explicit sslmode", ({ env, file }) => {
    const tracked = fs.readFileSync(file, "utf8");
    for (const key of DATABASE_VARS) {
      const mutated = withDatabaseUrl(
        tracked,
        key,
        "postgresql://coffeemode:stub@<db-host>:5432/coffeemode",
      );
      expect(() => assertLocalDatabaseTargets(mutated, env)).toThrow(/sslmode=disable/);
    }
  });
});
