#!/usr/bin/env node
/**
 * CoffeeMode local Supabase Auth mock (S2 testkit-compose-mocks).
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
 *   #   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
 *
 * The fake JWT shape matches web/tests/helpers/auth.ts:fakeJwt — header HS256,
 * payload { sub, role: "authenticated", exp } with a dummy signature. Nothing
 * verifies the signature; the web app's Supabase client is pointed at this
 * mock only in local compose, and tests stub auth via helpers/auth.ts directly.
 */

const PORT = Number(process.env.SUPABASE_MOCK_PORT ?? 54321);
const HOST = process.env.HOST ?? "0.0.0.0";

function base64UrlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}

function fakeJwt(userId, extra = {}, expiresInSec = 3600) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
      ...extra,
    }),
  );
  const signature = base64UrlEncode("fake-signature");
  return `${header}.${payload}.${signature}`;
}

function decodeFakeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
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

import http from "node:http";

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
    const userId = typeof body.userId === "string" && body.userId ? body.userId : `mock-${Buffer.from(email).toString("hex").slice(0, 8)}`;
    const token = fakeJwt(userId, { email });
    json(res, 200, {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: `mock-refresh-${userId}`,
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
    json(res, 200, { id: payload.sub, email: payload.email ?? "local@coffeemode.test", role: "authenticated" });
    return;
  }

  if (req.method === "POST" && path === "/auth/v1/logout") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
    });
    res.end();
    return;
  }

  // Fallback: 404 but still health-friendly for probes hitting /status etc
  if (req.method === "GET" && path.startsWith("/auth/")) {
    json(res, 404, { error: "not_found", message: `mock has no handler for ${path}` });
    return;
  }

  json(res, 200, { ok: true, service: "supabase-mock", hint: "GET /auth/v1/health" });
});

server.listen(PORT, HOST, () => {
  console.log(`[supabase-mock] listening on http://${HOST}:${PORT} (health: /auth/v1/health)`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
