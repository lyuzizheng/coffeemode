/**
 * Postgres connection URL → `pg` config translation (BRAWUKA-741).
 *
 * Single source for the `sslmode` vocabulary ADR-0002 defines (revised by
 * issue #41): `require`/`prefer`/`verify-ca`/`verify-full` validate the CA
 * chain, `allow-self-signed` is the explicit opt-in for self-managed certs
 * without a public CA chain, `disable` is plaintext, and anything else —
 * including the empty `sslmode=` — fails closed instead of silently meaning
 * plaintext. Seven copies of that table had already drifted apart (the app
 * pool, the migration runner, the drift checker, three ops scripts, and the
 * Supabase provisioning suite); one copy also defaulted Supabase hosts to
 * strict TLS when `sslmode` was absent. That host heuristic is gone
 * (BRAWUKA-1012): TLS is decided by `sslmode` alone, so a caller that needs
 * TLS states it in the URL and a hosted-database URL can never be silently
 * upgraded by its hostname. ADR-0010 §2 relies on this — the Dokploy internal
 * service states `disable` explicitly.
 *
 * `sslmode` is removed from the returned `connectionString` because `pg`'s own
 * connection-string parser maps the token differently and its result would win
 * over the caller's `ssl` value. `sslrootcert`/`sslcert`/`sslkey` are
 * deliberately left in the URL: `pg` turns those into its own ssl options, and
 * that override is intended. An absent `sslmode` returns no `ssl` key at all,
 * so `pg` keeps its own default (plain local TCP unless `PGSSLMODE` is set) —
 * that is what lets docker-compose Postgres and the local kit work unconfigured.
 *
 * Pure ESM with no imports so every runtime can load it: `node` CLIs (shipped
 * verbatim into the standalone image under `scripts/`) and the Next.js server
 * bundle (`web/lib/db/postgres.ts`).
 */

/** Modes whose CA chain must validate; Node also checks the hostname when a servername is present. */
const STRICT_TLS_MODES = new Set(["require", "prefer", "verify-ca", "verify-full"]);

/**
 * @param {string} urlString Postgres connection URL (`DATABASE_URL` / `DIRECT_URL`).
 * @returns {{ connectionString: string, ssl?: boolean | { rejectUnauthorized: boolean } }}
 */
export function parsePostgresConnection(urlString) {
  const url = new URL(urlString);
  // `get` returns null when the parameter is absent but "" for `sslmode=`, so
  // the empty value reaches the rejection arm instead of meaning plaintext.
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");

  const config = { connectionString: url.toString() };

  if (sslmode === null) return config;

  if (sslmode === "disable") {
    config.ssl = false;
  } else if (sslmode === "allow-self-signed") {
    // Encrypts the channel but accepts any certificate — vulnerable to MITM.
    config.ssl = { rejectUnauthorized: false };
  } else if (STRICT_TLS_MODES.has(sslmode)) {
    config.ssl = { rejectUnauthorized: true };
  } else {
    // Fail closed: a typo must not silently downgrade to plaintext.
    throw new Error(
      `Unrecognized sslmode "${sslmode}" in DATABASE_URL. Use require, prefer, verify-ca, verify-full, allow-self-signed, or disable.`,
    );
  }

  return config;
}
