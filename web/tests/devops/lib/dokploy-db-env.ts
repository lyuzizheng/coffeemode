import { expect } from "vitest";

/**
 * BRAWUKA-1012: the Dokploy env-template database gate. Kept in `lib/` so the
 * case matrix in `dokploy-db-host-contract.test.ts` stays under the file budget
 * (spec 0009 §3); both halves — assignment detection and effective-target
 * validation — remain one contract.
 *
 * The gate models what Docker Compose and `pg` actually do, because each of
 * those behaviors was a way for a hosted target to pass a naive check:
 *   - Compose's env-file reader accepts `KEY=value`, `KEY: value`,
 *     `export KEY=value` and spaces around the separator, and keeps the last
 *     definition — so the gate requires exactly one definition.
 *   - `pg-connection-string` resolves `host`/`port` from the query after the
 *     authority, percent-decodes the hostname, and DNS ignores case and a
 *     trailing dot — so the gate rejects extra parameters and normalizes the
 *     host before the provider check.
 *   - `pg` falls back to `PGHOST`/`PGPORT` when the URL omits them — so the
 *     gate requires a nonempty authority host and an explicit `:5432`.
 */

export const DATABASE_VARS = ["DATABASE_URL", "DIRECT_URL"] as const;

/** Provider domains that only ever serve a hosted database in these templates. */
const HOSTED_DATABASE_DOMAINS = ["supabase.co", "supabase.net", "supabase.com"];

/**
 * Every active assignment of `key`, in file order. Every Compose-supported
 * separator is accepted (`=`, `:`, an `export` prefix, spaces around the
 * separator): a spelling the gate cannot see is how a duplicate hides.
 */
export function envAssignments(content: string, key: string): string[] {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*[=:](.*)$`, "gm");
  return Array.from(content.matchAll(pattern), ([, value]) =>
    // A `KEY: value` entry carries one separating space that is not the value.
    value.trim().replace(/^["']|["']$/g, ""),
  );
}

export function singleEnvValue(content: string, key: string, env: string): string {
  const values = envAssignments(content, key);
  if (values.length !== 1) {
    throw new Error(`${env} template must define ${key} exactly once (found ${values.length})`);
  }
  return values[0];
}

/** Exact domain or a real subdomain; `db.supabase.co.evil.example` is not one. */
export function isHostedDatabaseHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return HOSTED_DATABASE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * The gate. Throws (never returns a boolean) so a mutant template fails the
 * suite with the offending variable named.
 */
export function assertLocalDatabaseTargets(content: string, env: string): void {
  for (const key of DATABASE_VARS) {
    // `<...>` is resolved by Dokploy env at deploy time; the sentinel keeps the
    // URL parseable. Any other spelling passes through untouched.
    const url = new URL(
      singleEnvValue(content, key, env).replace(/<([A-Za-z0-9_-]+)>/g, "$1.internal.invalid"),
    );

    expect(["postgres:", "postgresql:"], `${env} ${key} must be a Postgres URL`).toContain(
      url.protocol,
    );

    // `pg` would take PGHOST/PGPORT from the container environment, not from a
    // template that states neither.
    expect(url.hostname, `${env} ${key} must name a host`).not.toBe("");
    expect(url.port, `${env} ${key} must state port 5432 explicitly`).toBe("5432");

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
  }
}
