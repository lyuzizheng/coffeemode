#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import { decodeFakeJwt as decodeOrThrow, fakeJwt } from "./fake-jwt.mjs";
/**
 * CafeMood local Supabase Auth mock (S2 testkit-compose-mocks).
 *
 * Tiny GoTrue stand-in for `docker compose` local kit. It does NOT implement
 * Supabase — it only returns deterministic unsigned fake JWTs so that
 * web/tests/helpers/auth.ts and manual flows can run without real Supabase
 * credentials or `supabase start`.
 *
 * Endpoints:
 *   GET  /auth/v1/health          -> { ok: true, service: "supabase-mock" }
 *   GET  /auth/v1/settings        -> minimal GoTrue settings (external providers disabled locally)
 *   POST /auth/v1/token           -> { access_token: fakeJwt, token_type: "bearer", ... }
 *          body: { email?, password?, grant_type? } — any email is accepted; user id is derived
 *   GET  /auth/v1/user            -> { id, email } when Authorization: Bearer <token> present
 *   POST /auth/v1/logout          -> 204 (no-op)
 *   GET  / (root)                 -> { ok: true, service: "supabase-mock" }
 *
 * Real Supabase CLI alternative:
 *   supabase start  # local stack on :54321 (API), :54322 (DB), etc — stop this mock first:
 *   docker compose stop supabase-mock
 *   # then set in web/.env.local:
 *   #   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
 *   #   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key from supabase status>
 *
 * The fake JWT shape is the single source in scripts/fake-jwt.mjs — header
 * HS256, payload { sub, role: "authenticated", exp } with a dummy signature.
 * Nothing verifies the signature; the web app's Supabase client is pointed at
 * this mock only in local compose, and tests stub auth via helpers/auth.ts
 * directly.
 */

const PORT = Number(process.env.SUPABASE_MOCK_PORT ?? 54321);
const HOST = process.env.HOST ?? "127.0.0.1";

// Map the shared throwing decoder to the mock's nullable contract: a
// malformed token is a 401, not a crash.
function decodeFakeJwt(token) {
  try {
    return decodeOrThrow(token);
  } catch {
    return null;
  }
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function deriveUserId(email) {
  const hash = crypto.createHash("sha256").update(email).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// Server-held metadata (BRAWUKA-723/750): real GoTrue stores provider
// metadata server-side and returns it on /user; it never rides the bearer.
// The oversized fixture is two capped 2020-char CJK avatar URLs (~12 KiB
// as /user JSON, over the 8 KiB verified-user header budget). It is scoped
// to the refreshed bearer, never the user (BRAWUKA-759): POST /token with a
// marked refresh token mints a bearer carrying only a tiny fixture claim,
// and GET /user serves the fixture for bearers carrying that claim alone.
// No per-user store exists, so ordinary sessions for the same user —
// before, after, or concurrently — are unaffected, and consecutive suite
// runs against one mock process stay green. Any session user (boundary U1
// or the E2E fixture user) stages it; bearer and cookie stay small.
const OVERSIZED_MARKER = "mock-refresh-oversized-";
const OVERSIZED_CLAIM = "oversized_fixture";
const OVERSIZED_RECIPE = "cjk-2020-avatar";
function oversizedMetadata() {
  return {
    avatar_url: `https://example.com/${"李".repeat(2000)}`,
    picture: `https://example.com/${"李".repeat(2000)}`,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (path === "/" || path === "/auth/v1/health")) {
    json(res, 200, { ok: true, service: "supabase-mock" });
    return;
  }

  if (req.method === "GET" && path === "/auth/v1/settings") {
    json(res, 200, {
      external: { apple: false, google: false },
      disable_signup: false,
      mailer_autoconfirm: true,
      phone_confirm: false,
    });
    return;
  }

  if (req.method === "POST" && path === "/auth/v1/token") {
    const body = await parseBody(req);
    // Accept any email/password; derive a stable user id from email or use provided userId.
    const email = typeof body.email === "string" && body.email ? body.email : "local@coffeemode.test";
    // A marked refresh token names its session user in the suffix (the
    // refresh body carries no userId, so the derived id would be wrong).
    // Like real GoTrue, refresh preserves the session's user — the minted
    // bearer carries that same sub. The bearer carries only a tiny fixture
    // claim (tens of bytes); the 12 KiB claim set never rides a token,
    // cookie, or the /token response, so rotation cookies always fit.
    const marked =
      typeof body.refresh_token === "string" && body.refresh_token.startsWith(OVERSIZED_MARKER)
        ? body.refresh_token.slice(OVERSIZED_MARKER.length)
        : null;
    const userId = marked ?? (typeof body.userId === "string" && body.userId ? body.userId : deriveUserId(email));
    // The token-response user object stays small (real GoTrue keeps
    // metadata server-side — it never rides the response into the
    // persisted session cookie). The staged fixture is served on /user
    // below, which is where getUser() actually reads it.
    const token =
      marked !== null
        ? fakeJwt(userId, { email, [OVERSIZED_CLAIM]: OVERSIZED_RECIPE })
        : fakeJwt(userId, { email });
    json(res, 200, {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: body.refresh_token ?? `mock-refresh-${userId}`,
      user: { id: userId, email, role: "authenticated" },
    });
    return;
  }

  if (req.method === "GET" && path === "/auth/v1/user") {
    const auth = req.headers.authorization ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const payload = token ? decodeFakeJwt(token) : null;
    if (!payload?.sub) {
      json(res, 401, { error: "unauthorized", message: "missing or invalid token" });
      return;
    }
    // Real GoTrue returns the user's server-held metadata here. Unicode
    // suite names ride the JWT claims (small enough for every budget); a
    // bearer carrying the fixture claim is served the oversized recipe —
    // verification succeeds on a small bearer and the encoder, not the
    // transport, is what rejects the identity (BRAWUKA-723/750).
    const userBody = { id: payload.sub, email: payload.email ?? "local@coffeemode.test", role: "authenticated" };
    if (payload[OVERSIZED_CLAIM] === OVERSIZED_RECIPE) userBody.user_metadata = oversizedMetadata();
    else if (payload.user_metadata !== undefined) userBody.user_metadata = payload.user_metadata;
    json(res, 200, userBody);
    return;
  }

  if (req.method === "POST" && path === "/auth/v1/logout") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
    });
    res.end();
    return;
  }

  // Fallback: unknown /auth/* (any method) and everything else get 404 — a 200
  // fallback would be misparseable as a real GoTrue response by client libs.
  if (path.startsWith("/auth/")) {
    json(res, 404, { error: "not_found", message: `mock has no handler for ${req.method} ${path}` });
    return;
  }

  json(res, 404, { error: "not_found", message: `mock has no handler for ${req.method} ${path}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[supabase-mock] listening on http://${HOST}:${PORT} (health: /auth/v1/health)`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
