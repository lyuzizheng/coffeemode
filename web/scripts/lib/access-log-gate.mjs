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
 *   - Non-API traffic keeps its proxy access line.
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
 *   exclusions     health GET/HEAD, heartbeat, config → 200, zero lines
 *   non-API        GET /cafes/<uuid>                  → one proxy line
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

async function checkNonApiProxyLine(base, captureServerOutput) {
  const cafeId = randomUUID();
  const requestId = randomUUID();
  const pageRes = await fetch(`${base}/cafes/${cafeId}`, { headers: { "x-request-id": requestId } });
  await pageRes.arrayBuffer();
  assert(pageRes.status === 200 || pageRes.status === 404, `cafe page returned ${pageRes.status}`);
  const lines = accessLines(captureServerOutput(), requestId);
  assert(lines.length === 1, `expected one proxy access line for page, got ${lines.length}`);
  assert(lines[0].path === `/cafes/${cafeId}`, `proxy line path ${lines[0].path} !== page path`);
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
  await checkNonApiProxyLine(base, captureServerOutput);
}
