/**
 * Core domain API contract checks (issue #155) — split out of
 * `scripts/e2e-smoke.mjs` to keep that runner inside the 400-line file
 * budget. Each assertion is a plain fetch against the standalone build.
 * Failures propagate to the registry loop, which records them via
 * `recordGateFailure` — no local catch, so each error lands once.
 */
import { assert } from "./gate-assert.mjs";
import { clearGateArtifacts } from "./e2e-artifacts.mjs";

/**
 * @param {object} options
 * @param {string} options.base   served origin of the standalone build.
 * @param {string} options.cafeId DB-seeded cafe id for the navigations probe.
 */
export async function runApiContractGate({ base, cafeId }) {
  clearGateArtifacts("api-contract");
  const healthRes = await fetch(`${base}/api/health`);
  assert(healthRes.status === 200, `/api/health returned ${healthRes.status}`);

  const cafesRes = await fetch(`${base}/api/cafes?lat=37.7749&lng=-122.4194`);
  assert(cafesRes.status === 200, `/api/cafes returned ${cafesRes.status}`);
  const cafesData = await cafesRes.json();
  assert(Array.isArray(cafesData.cafes), "/api/cafes response missing 'cafes' array");

  const searchRes = await fetch(`${base}/api/search?q=smoke`);
  assert(searchRes.status === 200, `/api/search returned ${searchRes.status}`);

  const placesRes = await fetch(`${base}/api/places/search?q=smoke&lat=37.7749&lng=-122.4194`);
  // 200 when POI service is live, 502 `poi_service` envelope when unconfigured
  // (spec 0011: registry allows only {502,404,413,422} for `poi_service`;
  // 503 is reserved for `db_unavailable`/`mapkit_not_configured`).
  assert(
    placesRes.status === 200 || placesRes.status === 502,
    `/api/places/search returned unexpected status ${placesRes.status}`,
  );

  const navRes = await fetch(`${base}/api/navigations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({
      cafe_id: cafeId,
    }),
  });
  // 401 without auth session, 201 when authenticated
  assert(navRes.status === 401 || navRes.status === 201, `/api/navigations returned unexpected ${navRes.status}`);

  const promptRes = await fetch(`${base}/api/navigations/prompt`);
  // Auth-gated read: 401 without a session.
  assert(promptRes.status === 401, `/api/navigations/prompt returned unexpected ${promptRes.status}`);

  const resolveRes = await fetch(`${base}/api/navigations/${cafeId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ outcome: "wont_go" }),
  });
  // 401 without auth session (the seeded id is a cafe, not a navigation —
  // auth runs before the row lookup).
  assert(resolveRes.status === 401, `/api/navigations/[id]/resolve returned unexpected ${resolveRes.status}`);

  // T17 server half: Turnstile bot verification on POST /api/places/resolve.
  // Fails closed in production (403 bot_verification_failed), and bot gate
  // precedes input validation (403 before any 400/422).
  const turnstileNoTokenRes = await fetch(`${base}/api/places/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ maps_share_url: "https://maps.app.goo.gl/test" }),
  });
  assert(
    turnstileNoTokenRes.status === 403,
    `/api/places/resolve without turnstile token returned ${turnstileNoTokenRes.status}, expected 403`,
  );
  const turnstileNoTokenData = await turnstileNoTokenRes.json();
  assert(
    turnstileNoTokenData?.error === "bot_verification_failed" || turnstileNoTokenData?.error?.code === "bot_verification_failed",
    `Expected bot_verification_failed, got ${JSON.stringify(turnstileNoTokenData?.error)}`,
  );

  // Precedes input validation: empty body (which would otherwise 400) still yields 403
  const turnstileEmptyBodyRes = await fetch(`${base}/api/places/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({}),
  });
  assert(
    turnstileEmptyBodyRes.status === 403,
    `/api/places/resolve with empty body returned ${turnstileEmptyBodyRes.status}, expected 403 (bot check precedes validation)`,
  );
  const turnstileEmptyBodyData = await turnstileEmptyBodyRes.json();
  assert(
    turnstileEmptyBodyData?.error === "bot_verification_failed" || turnstileEmptyBodyData?.error?.code === "bot_verification_failed",
    `Expected bot_verification_failed on empty body, got ${JSON.stringify(turnstileEmptyBodyData?.error)}`,
  );
}
