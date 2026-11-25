#!/usr/bin/env node
/**
 * CafeMood closed-beta allowlist CLI (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * The invited-address list lives in the `beta_allowlist` table — never in this
 * repository. This script is the operator's one entry point:
 *
 *   node scripts/beta-allowlist.mjs list
 *   node scripts/beta-allowlist.mjs add lv@example.com --note "owner"
 *   node scripts/beta-allowlist.mjs remove lv@example.com
 *
 * Writes are idempotent: `add` re-invites a revoked address (clearing
 * `revoked_at`), `remove` retires a live one and reports whether anything
 * changed. Nothing is cached in the app: a revoke refuses the account's next
 * page request and next API call, and an invite admits it on the same terms
 * (BRAWUKA-972 criterion 1).
 *
 * Connection: `--database-url` or `DATABASE_URL` (the same value the app
 * uses). No default — pointing this at the wrong database would edit a real
 * allowlist.
 *
 * Two stores (ADR-0010 §1): this roster lives in the application database and
 * is the only authority. Supabase Auth keeps its own user store, and with
 * public sign-ups OFF an address must also EXIST there before its first Google
 * sign-in. `add` therefore provisions the Auth account too when
 * SUPABASE_URL + SUPABASE_SECRET_KEY are set (idempotent; `--no-provision`
 * skips it). Without the key it prints the dashboard step instead of failing
 * silently — a roster row without an Auth account can never sign in.
 */
import pg from "pg";

const USAGE = `CafeMood closed-beta allowlist

Usage:
  node scripts/beta-allowlist.mjs list                     [--database-url <url>] [--json]
  node scripts/beta-allowlist.mjs add <email> [--note <text>] [--database-url <url>]
  node scripts/beta-allowlist.mjs remove <email>           [--database-url <url>]

Environment:
  DATABASE_URL        Postgres connection string (used when --database-url is absent).
  SUPABASE_URL        Supabase project URL (provisioning; NEXT_PUBLIC_SUPABASE_URL accepted).
  SUPABASE_SECRET_KEY Secret key for the Auth Admin API (legacy SUPABASE_SERVICE_ROLE_KEY accepted).

Options:
  --no-provision      Write the roster row only; provision the Auth user elsewhere.
`;

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fail(message) {
  console.error(`beta-allowlist: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "json" || name === "no-provision") {
      flags[name] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`--${name} needs a value`);
    }
    flags[name] = value;
    i += 1;
  }
  return { positional, flags };
}

function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) {
    fail(`not an email address: ${JSON.stringify(raw)}`);
  }
  return email;
}

function connectionString(flags) {
  const url = flags["database-url"] ?? process.env.DATABASE_URL ?? process.env.STAGING_DATABASE_URL;
  if (!url) fail("no database — pass --database-url or set DATABASE_URL");
  return url;
}

async function listEmails(client, asJson) {
  const { rows } = await client.query(
    `select email, note, created_at, revoked_at
       from beta_allowlist
      order by revoked_at nulls first, created_at desc`,
  );
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("beta_allowlist is empty — nobody can sign in while the gate is on.");
    return;
  }
  const live = rows.filter((row) => row.revoked_at === null);
  console.log(`${live.length} live / ${rows.length} total\n`);
  for (const row of rows) {
    const state = row.revoked_at === null ? "live   " : "revoked";
    const note = row.note ? `  (${row.note})` : "";
    console.log(`${state}  ${row.email}${note}`);
  }
}

async function addEmail(client, email, note) {
  await client.query(
    `insert into beta_allowlist (email, note)
     values ($1, $2)
     on conflict (email) do update
        set note = excluded.note,
            revoked_at = null`,
    [email, note ?? null],
  );
  console.log(`invited  ${email}${note ? `  (${note})` : ""}`);
}

function supabaseAdmin() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/+$/,
    "",
  );
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, secret };
}

/**
 * Provision the address in Supabase Auth (one user store, one roster).
 *
 * Pre-provisioning is what makes the first Google sign-in succeed while public
 * sign-ups are closed: GoTrue links the Google identity to the existing user by
 * its verified email. It is a precondition, never a grant — the app still
 * refuses any address missing from `beta_allowlist`, and the roster is written
 * before this call.
 */
async function provisionAuthUser(email, skip) {
  const { url, secret } = supabaseAdmin();
  if (skip) {
    console.log("skipped Auth provisioning  (--no-provision)");
    return;
  }
  if (!url || !secret) {
    console.log(
      "warning: Supabase Auth not provisioned — set SUPABASE_URL + SUPABASE_SECRET_KEY, " +
        "or add this user in the dashboard before their first sign-in",
    );
    return;
  }
  let response;
  try {
    response = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: secret,
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ email, email_confirm: true }),
    });
  } catch (err) {
    fail(`Supabase Auth unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await response.json().catch(() => null);
  if (response.ok) {
    console.log(`provisioned  ${email}  (Supabase Auth)`);
    return;
  }
  if (response.status === 422 && body?.error_code === "email_exists") {
    console.log(`already provisioned  ${email}  (Supabase Auth)`);
    return;
  }
  fail(
    `Supabase Auth refused to provision ${email} (${response.status}): ` +
      `${body?.msg ?? body?.message ?? body?.error ?? "no body"} — ` +
      "the roster row is written; fix the Auth account before the first sign-in",
  );
}

async function removeEmail(client, email) {
  const { rowCount } = await client.query(
    `update beta_allowlist
        set revoked_at = now()
      where email = $1 and revoked_at is null`,
    [email],
  );
  if (rowCount === 0) {
    console.log(`no live entry for ${email} — nothing to revoke`);
    return;
  }
  console.log(`revoked  ${email}`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, emailArg] = positional;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }
  if (!["list", "add", "remove"].includes(command)) {
    fail(`unknown command "${command}"\n\n${USAGE}`);
  }

  const email = command === "list" ? null : normalizeEmail(emailArg);
  const client = new pg.Client({ connectionString: connectionString(flags) });

  await client.connect();
  try {
    if (command === "list") await listEmails(client, Boolean(flags.json));
    if (command === "add") {
      await addEmail(client, email, flags.note);
      await provisionAuthUser(email, Boolean(flags["no-provision"]));
    }
    if (command === "remove") await removeEmail(client, email);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`beta-allowlist: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
