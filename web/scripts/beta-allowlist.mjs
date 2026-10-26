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
 * changed. Revocation is effective at the next sign-in attempt, and within
 * `beta.allowlistCacheSeconds` for an already-open session (the API gate
 * re-reads the allowlist; the page gate rewrites the next navigation to the
 * beta surface).
 *
 * Connection: `--database-url` or `DATABASE_URL` (the same value the app
 * uses). No default — pointing this at the wrong database would edit a real
 * allowlist.
 */
import pg from "pg";

const USAGE = `CafeMood closed-beta allowlist

Usage:
  node scripts/beta-allowlist.mjs list                     [--database-url <url>] [--json]
  node scripts/beta-allowlist.mjs add <email> [--note <text>] [--database-url <url>]
  node scripts/beta-allowlist.mjs remove <email>           [--database-url <url>]

Environment:
  DATABASE_URL   Postgres connection string (used when --database-url is absent).
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
    if (name === "json") {
      flags.json = true;
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
    if (command === "add") await addEmail(client, email, flags.note);
    if (command === "remove") await removeEmail(client, email);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`beta-allowlist: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
