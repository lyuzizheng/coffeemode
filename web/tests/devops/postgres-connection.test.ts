import { describe, expect, it } from "vitest";
import { parsePostgresConnection } from "../../scripts/lib/postgres-connection.mjs";

// BRAWUKA-741: the sslmode vocabulary used to be copied into seven callers.
// These tables are the contract the app pool (`lib/db/postgres.ts`), the
// migration/drift/ops CLIs, and the Supabase provisioning wrapper now share;
// the wrapper's Supabase-host default has its own table below.

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

  // The Supabase strict default belongs to the provisioning wrapper alone: the
  // app pool and the CLIs must still reach a Supabase host that carries no
  // sslmode exactly the way they did before BRAWUKA-741 (driver default).
  it("does not apply the Supabase default on its own", () => {
    expect(parsePostgresConnection(url("", "db.ref.supabase.co:5432")).ssl).toBeUndefined();
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

describe("parsePostgresConnection — strictTlsForSupabaseHosts policy", () => {
  const PROVISIONING_CASES: ReadonlyArray<[string, string, string, Ssl]> = [
    ["*.supabase.co direct host", "db.ref.supabase.co:5432", "", STRICT_TLS],
    ["*.supabase.net direct host", "db.ref.supabase.net:5432", "", STRICT_TLS],
    ["non-Supabase host keeps the driver default", "localhost:5432", "", undefined],
    ["explicit disable wins over the host default", "db.ref.supabase.co:5432", "?sslmode=disable", false],
    [
      "explicit allow-self-signed wins over the host default",
      "db.ref.supabase.co:5432",
      "?sslmode=allow-self-signed",
      SELF_SIGNED_TLS,
    ],
    // Preserved boundary, not a claim: the suffix match needs the leading dot,
    // and pooler hosts (…pooler.supabase.com) were never covered by the
    // provisioning default — their URLs carry an explicit `sslmode=require`.
    ["lookalike host is not a Supabase host", "db.xsupabase.co:5432", "", undefined],
    ["pooler host stays outside the allowlist", "aws-0-staging.pooler.supabase.com:6543", "", undefined],
  ];

  it.each(PROVISIONING_CASES)("%s", (_label, host, query, expected) => {
    expect(
      parsePostgresConnection(url(query, host), { strictTlsForSupabaseHosts: true }).ssl,
    ).toEqual(expected);
  });
});
