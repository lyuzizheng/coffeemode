/**
 * Core domain API contract checks (issue #155) — split out of
 * `scripts/e2e-smoke.mjs` to keep that runner inside the 400-line file
 * budget. Each assertion is a plain fetch against the standalone build.
 */

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * @param {object} options
 * @param {string} options.base   served origin of the standalone build.
 * @param {string} options.cafeId DB-seeded cafe id for the navigations probe.
 */
export async function runApiContractGate({ base, cafeId }) {
  const healthRes = await fetch(`${base}/api/health`);
  assert(healthRes.status === 200, `/api/health returned ${healthRes.status}`);

  const cafesRes = await fetch(`${base}/api/cafes?lat=37.7749&lng=-122.4194`);
  assert(cafesRes.status === 200, `/api/cafes returned ${cafesRes.status}`);
  const cafesData = await cafesRes.json();
  assert(Array.isArray(cafesData.cafes), "/api/cafes response missing 'cafes' array");

  const searchRes = await fetch(`${base}/api/search?q=smoke`);
  assert(searchRes.status === 200, `/api/search returned ${searchRes.status}`);

  const placesRes = await fetch(`${base}/api/places/search?q=smoke&lat=37.7749&lng=-122.4194`);
  // 200 when POI service is live, 503 with standard envelope when unconfigured
  assert(
    placesRes.status === 200 || placesRes.status === 503,
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
}
