/**
 * API access-log HTTP gate (BRAWUKA-729 acceptance, BRAWUKA-755).
 *
 * Proves the completed-request access stream against a running production
 * build, through the real proxy → route pipeline over HTTP — the one thing
 * direct handler invocation cannot prove:
 *
 *   - HTTP status, envelope `code`, and `x-request-id` echo correlate with
 *     exactly one captured `type:"access"` line per request (no duplicate
 *     proxy success entry, no query leakage into `path`).
 *   - `duration_ms` covers handler latency (dead-DB 5xx fails the real pool
 *     round-trip; the line carries the elapsed time).
 *   - The accepted hot-path exclusions (BRAWUKA-756, spec 0011 edge cases)
 *     stay silent: `GET`/`HEAD /api/health`, `GET /api/heartbeat`,
 *     `GET /api/config` emit no access line while still serving 200.
 *   - Non-API traffic keeps its proxy access line, scoped to the proxy phase
 *     (BRAWUKA-814): `status:"unknown"` + `proxy_duration_ms` on pass-through
 *     (200 page, 404 gone-cafe, 307 callback), the real status only when the
 *     proxy built the response (the `/?cafe=` 308). A dead-DB page 500 stays
 *     `"unknown"` — never the 200 placeholder that masked it before.
 *
 * Runs inside `npm run test:e2e`. Needs the suite's live-DB server (`base`,
 * `hasDb`) for the 2xx/429 cases plus one extra probe server on an
 * unreachable database port (`deadBase`) for the deterministic 5xx — the
 * app's own fail-closed pool behavior, not a fixture. No new endpoint, no
 * synthetic test route, no production writes (all anonymous side-effect-free
 * reads plus one rejected cross-site POST).
 *
 * Case matrix:
 *   2xx            GET /api/search?q=smoke            → 200, no code
 *   400            GET /api/cafes/not-a-uuid          → 400 invalid_request
 *   401            GET /api/navigations/prompt        → 401 unauthorized
 *   403            POST /api/checkins + cross-site     → 403 forbidden_origin
 *   429            31× GET /api/search                → a 429 rate_limited
 *   5xx            dead-DB GET /api/search?q=smoke    → 500 internal_error
 *   5xx page       dead-DB GET /cafes/<uuid>          → client 500, proxy "unknown"
 *   exclusions     health GET/HEAD, heartbeat, config → 200, zero lines
 *   page 200       GET /privacy                       → proxy "unknown"
 *   page 404       GET /cafes/<uuid>                  → proxy "unknown"
 *   callback 307   GET /auth/callback                 → proxy "unknown"
 *   proxy 308      GET /?cafe=<uuid>                  → proxy status 308
 */
import { randomUUID } from "node:crypto";
import { assert } from "./gate-assert.mjs";
import { clearGateArtifacts } from "./e2e-artifacts.mjs";

const SLUG = "access-log";

/**
 * Controlled handler latency for the 2xx duration lower-bound proof
 * (BRAWUKA-755): the managed harness always sets `E2E_ACCESS_LOG_DELAY_MS`
 * (default forwarding when unset), and the server sleeps that long inside
 * the real search dependency path — so a zero or pre-handler timer reports
 * below the floor and fails. The gate fails loud when the harness did not
 * inject the proof (env unset or unparseable outside the managed harness):
 * instead of silently downgrading to a zero floor, it names the missing
 * variable. Only an explicit `E2E_ACCESS_LOG_DELAY_MS=0` opts out (fast
 * smoke path), and the probe server then sleeps nothing, so both sides
 * agree. One value read from a single place.
 */
export const ACCESS_LOG_LATENCY_FLOOR_MS = 150;

export function accessLogDelayMs() {
  const raw = process.env.E2E_ACCESS_LOG_DELAY_MS;
  if (raw === undefined) {
    throw new Error(
      "E2E_ACCESS_LOG_DELAY_MS is unset — the managed harness (probe-servers.mjs) must forward it " +
        "(default 150). Refusing to downgrade to a zero floor.",
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `E2E_ACCESS_LOG_DELAY_MS=${JSON.stringify(raw)} is not a non-negative integer — refusing to downgrade to a zero floor.`,
    );
  }
  return Math.min(parsed, 500);
}

function accessLines(output, requestId) {
  return output
    .split("\n")
    .filter((line) => line.includes(requestId) && line.includes('"type":"access"'))
    .map((line) => JSON.parse(line));
}

async function fetchWithId(base, path, init = {}) {
  const requestId = randomUUID();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "x-request-id": requestId, ...(init.headers ?? {}) },
  });
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    // Non-JSON bodies (HEAD, page HTML) carry no envelope.
  }
  return { requestId, response, body };
}

function expectSingleCompletion(output, { requestId, status, code, path, method = "GET", minDurationMs = 0 }) {
  const lines = accessLines(output, requestId);
  assert(lines.length === 1, `expected exactly one access line for ${requestId}, got ${lines.length}`);
  const line = lines[0];
  assert(line.request_id === requestId, `access line request_id mismatch for ${path}`);
  assert(line.method === method, `access line method ${line.method} !== ${method} for ${path}`);
  assert(line.path === path, `access line path ${line.path} !== ${path} (query leaked?)`);
  assert(line.status === status, `access line status ${line.status} !== HTTP ${status} for ${path}`);
  if (code === undefined) {
    assert(!("code" in line), `access line must carry no code on ${status} for ${path}`);
  } else {
    assert(line.code === code, `access line code ${line.code} !== ${code} for ${path}`);
  }
  assert(typeof line.duration_ms === "number", `access line missing duration_ms for ${path}`);
  // BRAWUKA-755: a zero/pre-handler timer must fail — the completion line
  // carries guard+handler elapsed time, never a constant.
  assert(
    line.duration_ms >= minDurationMs,
    `access line duration_ms ${line.duration_ms} below proven ${minDurationMs}ms floor for ${path}`,
  );
  assert(typeof line.route === "string" && line.route.length > 0, `access line missing route for ${path}`);
  return line;
}

function expectSilent(output, requestId, path) {
  const lines = accessLines(output, requestId);
  assert(lines.length === 0, `expected no access line for excluded ${path}, got ${lines.length}`);
}

/**
 * The proxy's line describes its own phase only (BRAWUKA-814). `status` is the
 * real client status when the proxy built the response; otherwise it is the
 * literal `"unknown"` and no end-to-end latency/code may be claimed.
 */
function expectProxyPhaseLine(output, { requestId, path, status }) {
  const lines = accessLines(output, requestId);
  assert(lines.length === 1, `expected exactly one proxy access line for ${path}, got ${lines.length}`);
  const line = lines[0];
  assert(line.stage === "proxy", `proxy line stage ${JSON.stringify(line.stage)} !== "proxy" for ${path}`);
  assert(line.path === path, `proxy line path ${line.path} !== ${path}`);
  assert(
    line.status === status,
    `proxy line status ${JSON.stringify(line.status)} !== ${JSON.stringify(status)} for ${path}`,
  );
  assert(typeof line.proxy_duration_ms === "number", `proxy line missing proxy_duration_ms for ${path}`);
  assert(!("duration_ms" in line), `proxy line must not claim duration_ms for ${path}`);
  assert(!("code" in line), `proxy line must not claim code for ${path}`);
  return line;
}

async function checkLive2xx(base, captureServerOutput) {
  const startedAt = Date.now();
  const live = await fetchWithId(base, "/api/search?q=smoke");
  const elapsedMs = Date.now() - startedAt;
  assert(live.response.status === 200, `GET /api/search returned ${live.response.status}`);
  assert(live.body && Array.isArray(live.body.results), "GET /api/search response missing 'results' array");
  const echoed = live.response.headers.get("x-request-id");
  assert(echoed === live.requestId, `x-request-id echo ${echoed} !== ${live.requestId}`);
  // BRAWUKA-755: the managed harness always injects the latency floor into
  // the real handler path (default ACCESS_LOG_LATENCY_FLOOR_MS), so a zero
  // or pre-handler timer reports below it and fails — no silent downgrade.
  const floorMs = accessLogDelayMs();
  const line = expectSingleCompletion(captureServerOutput(), {
    requestId: live.requestId,
    status: 200,
    path: "/api/search",
    minDurationMs: floorMs,
  });
  assert(
    line.duration_ms <= elapsedMs + 5000,
    `2xx duration_ms ${line.duration_ms} exceeds client-observed ${elapsedMs}ms`,
  );
}

async function checkRateLimit(base, captureServerOutput) {
  let denied = null;
  for (let i = 0; i < 31; i += 1) {
    const attempt = await fetchWithId(base, "/api/search?q=smoke");
    if (attempt.response.status === 429) denied = attempt;
  }
  assert(denied !== null, "search bucket never tripped 429 within 31 requests");
  assert(denied.body?.error === "rate_limited", `expected rate_limited, got ${denied.body?.error}`);
  expectSingleCompletion(captureServerOutput(), {
    requestId: denied.requestId,
    status: 429,
    code: "rate_limited",
    path: "/api/search",
  });
}

async function checkDeadDb5xx(deadBase, captureServerOutput) {
  const startedAt = Date.now();
  const dead = await fetchWithId(deadBase, "/api/search?q=smoke");
  const elapsedMs = Date.now() - startedAt;
  assert(dead.response.status === 500, `dead-DB GET /api/search returned ${dead.response.status}`);
  assert(dead.body?.error === "internal_error", `expected internal_error, got ${dead.body?.error}`);
  assert(dead.body?.request_id === dead.requestId, "500 envelope request_id does not match inbound id");
  // BRAWUKA-755: the dead-DB 500 fails the real pool round-trip, so the
  // completion line must carry positive elapsed time — a zero timer reports
  // no work at all and fails. The client-observed upper bound follows.
  const line = expectSingleCompletion(captureServerOutput(), {
    requestId: dead.requestId,
    status: 500,
    code: "internal_error",
    path: "/api/search",
    minDurationMs: 1,
  });
  assert(
    line.duration_ms >= Math.max(1, elapsedMs - 5000) && line.duration_ms <= elapsedMs + 5000,
    `5xx duration_ms ${line.duration_ms} outside client-observed ${elapsedMs}ms`,
  );

  // BRAWUKA-814: the same dead pool makes a page render fail. The client gets
  // a real 500, and the proxy line must say `"unknown"` — never the 200 of its
  // pass-through placeholder, which is what used to mask page failures.
  const cafeId = randomUUID();
  const pageRequestId = randomUUID();
  const page = await fetch(`${deadBase}/cafes/${cafeId}`, {
    headers: { "x-request-id": pageRequestId },
  });
  await page.arrayBuffer();
  assert(page.status === 500, `dead-DB cafe page returned ${page.status}, expected 500`);
  expectProxyPhaseLine(captureServerOutput(), {
    requestId: pageRequestId,
    path: `/cafes/${cafeId}`,
    status: "unknown",
  });
}

async function checkRejections(base, captureServerOutput) {
  const bad = await fetchWithId(base, "/api/cafes/not-a-uuid");
  assert(bad.response.status === 400, `GET /api/cafes/not-a-uuid returned ${bad.response.status}`);
  assert(bad.body?.error === "invalid_request", `expected invalid_request, got ${bad.body?.error}`);
  assert(bad.body?.request_id === bad.requestId, "400 envelope request_id does not match inbound id");
  expectSingleCompletion(captureServerOutput(), {
    requestId: bad.requestId,
    status: 400,
    code: "invalid_request",
    path: "/api/cafes/not-a-uuid",
  });

  const anon = await fetchWithId(base, "/api/navigations/prompt");
  assert(anon.response.status === 401, `GET /api/navigations/prompt returned ${anon.response.status}`);
  assert(anon.body?.error === "unauthorized", `expected unauthorized, got ${anon.body?.error}`);
  expectSingleCompletion(captureServerOutput(), {
    requestId: anon.requestId,
    status: 401,
    code: "unauthorized",
    path: "/api/navigations/prompt",
  });

  const forged = await fetchWithId(base, "/api/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json", "sec-fetch-site": "cross-site", Origin: base },
    body: JSON.stringify({}),
  });
  assert(forged.response.status === 403, `POST /api/checkins cross-site returned ${forged.response.status}`);
  assert(forged.body?.error === "forbidden_origin", `expected forbidden_origin, got ${forged.body?.error}`);
  expectSingleCompletion(captureServerOutput(), {
    requestId: forged.requestId,
    status: 403,
    code: "forbidden_origin",
    path: "/api/checkins",
    method: "POST",
  });
}

async function checkExclusions(base, captureServerOutput) {
  const health = await fetchWithId(base, "/api/health");
  assert(health.response.status === 200, `GET /api/health returned ${health.response.status}`);
  expectSilent(captureServerOutput(), health.requestId, "/api/health");

  const headId = randomUUID();
  const headRes = await fetch(`${base}/api/health`, { method: "HEAD", headers: { "x-request-id": headId } });
  assert(headRes.status === 200, `HEAD /api/health returned ${headRes.status}`);
  await headRes.arrayBuffer();
  expectSilent(captureServerOutput(), headId, "HEAD /api/health");

  const heartbeat = await fetchWithId(base, "/api/heartbeat");
  assert(heartbeat.response.status === 200, `GET /api/heartbeat returned ${heartbeat.response.status}`);
  expectSilent(captureServerOutput(), heartbeat.requestId, "/api/heartbeat");

  const config = await fetchWithId(base, "/api/config");
  assert(config.response.status === 200, `GET /api/config returned ${config.response.status}`);
  expectSilent(captureServerOutput(), config.requestId, "/api/config");
}

/**
 * Non-API traffic: the proxy line must describe the proxy phase, never the
 * page result (BRAWUKA-814). Four real server responses:
 *   - a normal page renders 200 → line `"unknown"`, not 200;
 *   - a gone-cafe deep link renders 404 → still `"unknown"`;
 *   - the proxy-built `/?cafe=` redirect is 308 → line `308` (final);
 *   - `/auth/callback` redirects 307 from the route → `"unknown"`.
 */
async function checkNonApiProxyLine(base, captureServerOutput, hasDb) {
  const pageId = randomUUID();
  const pageRes = await fetch(`${base}/privacy`, { headers: { "x-request-id": pageId } });
  await pageRes.arrayBuffer();
  assert(pageRes.status === 200, `GET /privacy returned ${pageRes.status}`);
  expectProxyPhaseLine(captureServerOutput(), {
    requestId: pageId,
    path: "/privacy",
    status: "unknown",
  });

  const cafeId = randomUUID();
  const requestId = randomUUID();
  const page = await fetch(`${base}/cafes/${cafeId}`, { headers: { "x-request-id": requestId } });
  await page.arrayBuffer();
  if (hasDb) {
    assert(page.status === 404, `gone-cafe page returned ${page.status}, expected 404`);
  } else {
    assert(page.status === 200 || page.status === 404, `cafe page returned ${page.status}`);
  }
  expectProxyPhaseLine(captureServerOutput(), {
    requestId,
    path: `/cafes/${cafeId}`,
    status: "unknown",
  });

  const callbackId = randomUUID();
  const callback = await fetch(`${base}/auth/callback`, {
    headers: { "x-request-id": callbackId },
    redirect: "manual",
  });
  await callback.arrayBuffer();
  assert(callback.status === 307, `GET /auth/callback returned ${callback.status}, expected 307`);
  expectProxyPhaseLine(captureServerOutput(), {
    requestId: callbackId,
    path: "/auth/callback",
    status: "unknown",
  });

  const redirectId = randomUUID();
  const legacy = await fetch(`${base}/?cafe=${cafeId}`, {
    headers: { "x-request-id": redirectId },
    redirect: "manual",
  });
  await legacy.arrayBuffer();
  assert(legacy.status === 308, `GET /?cafe=<id> returned ${legacy.status}, expected 308`);
  assert(
    (legacy.headers.get("location") ?? "").endsWith(`/cafes/${cafeId}`),
    `legacy redirect location ${legacy.headers.get("location")} does not target /cafes/${cafeId}`,
  );
  expectProxyPhaseLine(captureServerOutput(), {
    requestId: redirectId,
    path: "/",
    status: 308,
  });
}

export async function runAccessLogGate({ base, deadBase, hasDb, captureServerOutput, external = false }) {
  clearGateArtifacts(SLUG);

  // BRAWUKA-758: external mode (E2E_BASE_URL) owns no server process, so no
  // local access stream exists and the dead-DB probe never boots. Skipping
  // here keeps the remaining external HTTP/browser gates running instead of
  // failing every log assertion with zero captured lines.
  if (external) {
    console.log("[E2E] Skipping T28: no local server output under E2E_BASE_URL.");
    return;
  }

  // Without the suite's live DB only the DB-free cases can run: 400/401/403
  // rejections, the exclusions, and the non-API proxy line. The 2xx, 429,
  // and dead-DB 5xx cases need a reachable pool (or its deliberate absence).
  if (hasDb) {
    await checkLive2xx(base, captureServerOutput);
    await checkRateLimit(base, captureServerOutput);
    await checkDeadDb5xx(deadBase, captureServerOutput);
  }

  await checkRejections(base, captureServerOutput);
  await checkExclusions(base, captureServerOutput);
  await checkNonApiProxyLine(base, captureServerOutput, hasDb);
}
