import { describe, expect, it } from "vitest";
import { parsePostgresConnection } from "../../scripts/lib/postgres-connection.mjs";

// BRAWUKA-741: the sslmode vocabulary used to be copied into seven callers.
// These tables are the contract the app pool (`lib/db/postgres.ts`), the
// migration/drift/ops CLIs, and the Auth verification wrapper share. TLS is
// decided by `sslmode` alone (BRAWUKA-1012): no host carries a default.

type Ssl = boolean | { rejectUnauthorized: boolean } | undefined;

const STRICT_TLS = { rejectUnauthorized: true };
const SELF_SIGNED_TLS = { rejectUnauthorized: false };

function url(query: string, host = "localhost:5432"): string {
  return `postgres://user:pass@${host}/app${query}`;
}

const SSL_MODE_CASES: ReadonlyArray<[string, string, Ssl]> = [
  ["absent", "", undefined],
  ["disable", "?sslmode=disable", false],
  ["allow-self-signed", "?sslmode=allow-self-signed", SELF_SIGNED_TLS],
  ["require", "?sslmode=require", STRICT_TLS],
  ["prefer", "?sslmode=prefer", STRICT_TLS],
  ["verify-ca", "?sslmode=verify-ca", STRICT_TLS],
  ["verify-full", "?sslmode=verify-full", STRICT_TLS],
];

const REJECTED_MODE_CASES: ReadonlyArray<[string, string]> = [
  ["empty", "?sslmode="],
  ["unrecognized", "?sslmode=invalid"],
  ["wrong case", "?sslmode=REQUIRE"],
  ["truncated", "?sslmode=verif"],
];

describe("parsePostgresConnection — sslmode → pg ssl option", () => {
  it.each(SSL_MODE_CASES)("%s", (_label, query, expected) => {
    expect(parsePostgresConnection(url(query)).ssl).toEqual(expected);
  });

  it.each(REJECTED_MODE_CASES)("rejects %s instead of downgrading to plaintext", (_label, query) => {
    expect(() => parsePostgresConnection(url(query))).toThrow(/Unrecognized sslmode/);
  });

  it("strips sslmode from the connection string and keeps the other parameters", () => {
    const config = parsePostgresConnection(
      "postgres://user:pass@db.example.com:5432/app?sslmode=require&application_name=coffeemode",
    );
    expect(config.connectionString).toBe(
      "postgres://user:pass@db.example.com:5432/app?application_name=coffeemode",
    );
    expect(config.ssl).toEqual(STRICT_TLS);
  });
});

describe("parsePostgresConnection — TLS follows sslmode alone", () => {
  // BRAWUKA-1012: no host carries a TLS default. The URL states the mode, and
  // ADR-0010 §2 makes the Dokploy internal service state `disable`; a hosted
  // host with no sslmode keeps the driver default exactly like any other host.
  const HOST_CASES: ReadonlyArray<[string, string, string, Ssl]> = [
    ["Dokploy internal host", "db.internal:5432", "?sslmode=disable", false],
    ["Supabase-shaped host with no sslmode", "db.ref.supabase.co:5432", "", undefined],
    ["Supabase-shaped host with disable", "db.ref.supabase.co:5432", "?sslmode=disable", false],
    ["Supabase-shaped host with require", "db.ref.supabase.co:5432", "?sslmode=require", STRICT_TLS],
    ["pooler-shaped host with no sslmode", "aws-0-staging.pooler.supabase.com:6543", "", undefined],
  ];

  it.each(HOST_CASES)("%s", (_label, host, query, expected) => {
    expect(parsePostgresConnection(url(query, host)).ssl).toEqual(expected);
  });
});
