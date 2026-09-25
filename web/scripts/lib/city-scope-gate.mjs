/**
 * City-scope gate (BRAWUKA-715): E2E coverage for the client-only contracts
 * that lost their last assertions when BRAWUKA-714 deleted
 * `web/tests/onboarding-locate.test.ts` (unit layer banned per BRAWUKA-682;
 * the helpers have no HTTP surface, so integration suites can't reach them).
 *
 *   1. `displayCityName` precedence (lib/cities.ts): a profile row carrying
 *      `current_city='shanghai'` plus a forged `current_city_name` (written
 *      straight to the DB, bypassing the PATCH guard — BRAWUKA-696 self-harm
 *      boundary) still renders "Shanghai" en / "上海" zh on /profile; the
 *      forged string appears nowhere on the page.
 *   2. `resolveSearchScope` rt-* routing (lib/search/search-client.ts): with
 *      onboarding state holding a runtime city id, the discovery search
 *      field fires `/api/search?q=…&lat=…&lng=…` — never `?city=rt-*`
 *      (BRAWUKA-568). The response's `reference_point` is the coordinate
 *      anchor; a launch-city switch is the positive `?city=` control.
 *      Folded in: rt-* chip country fallback ("United States"), persisted
 *      `currentCityName` win ("Los Angeles"), unknown-id capitalization.
 * Needs DB (profile row + scope cafe) and supabase-mock for check 1's
 * session; check 2 is anonymous. Desktop only.
 */

import { assert, shot } from "./gate-assert.mjs";
import { assertSessionLanded, mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

const SLUG = "city-scope";
// Dedicated rows outside the fixture cleanup's `any($1)` lists — the gate deletes them itself in `finally`.
const FORGE_USER_ID = "e2e00000-0000-4000-a000-0000000000b1";
const SCOPE_CAFE_ID = "e2e00000-0000-4000-a000-0000000000b2";
const SCOPE_CAFE_NAME = "E2E Scope Cafe";
const FORGED_NAME = "Forged City";

// Runtime city + fix the locate flow would have persisted (DG121): LA zone
// id with the fixture-independent LA coordinates.
const RT_CITY_ID = "rt-america-los_angeles";
const RT_LAT = 34.0522;
const RT_LNG = -118.2437;

const ONBOARDING_KEY = "coffeemode:onboarding:v1";
const ONBOARDING_EVENT = "coffeemode:onboarding-changed";
const SEARCH_INPUT = "[data-slot='search-field-input']";

/** Seed the onboarding store before app JS runs (anonymous currentCity source). */
function seedOnboarding(state) {
  return `window.localStorage.setItem(${JSON.stringify(ONBOARDING_KEY)}, ${JSON.stringify(JSON.stringify(state))});`;
}

/** Rewrite the store in-page and dispatch the change event the store subscribes to. */
async function writeOnboarding(page, state) {
  await page.evaluate(
    ([key, event, value]) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new Event(event));
    },
    [ONBOARDING_KEY, ONBOARDING_EVENT, state],
  );
}

/**
 * Check 1 — forged `currentCityName` never wins for a launch id.
 * The DB write bypasses PATCH /api/profile's launch-id strip on purpose:
 * the client helper is the last line of defense (BRAWUKA-696).
 */
async function checkProfileCityPrecedence({ base, supabaseUrl, dbClient, createContext, attachErrorCollector, label }) {
  await dbClient.query(
    `insert into profiles (id, display_name, current_city, current_city_name)
     values ($1, 'E2E Forge', 'shanghai', $2)
     on conflict (id) do update set
       display_name = 'E2E Forge', current_city = 'shanghai', current_city_name = $2`,
    [FORGE_USER_ID, FORGED_NAME],
  );
  const sessionCookie = await mintSession(supabaseUrl, FORGE_USER_ID);
  assert(sessionCookie, `${label}: supabase-mock unreachable at ${supabaseUrl}`);

  for (const [locale, expected] of [["en", "Shanghai"], ["zh", "上海"]]) {
    await withGateContext(
      SLUG,
      createContext,
      {},
      async (context, consoleLines) => {
        await context.addCookies([
          { ...sessionCookie, url: base },
          { name: "locale", value: locale, url: base },
        ]);
        await assertSessionLanded({ base, supabaseUrl, request: context.request, label });
        const page = await context.newPage();
        const checkErrors = attachErrorCollector(page, label, { path: "/profile", status: 200 }, consoleLines);
        await page.goto(`${base}/profile`, { waitUntil: "domcontentloaded" });
        const chip = page.locator(`button:has-text("${expected}")`).first();
        await chip.waitFor({ state: "visible", timeout: 15000 });
        // innerText, not textContent: the RSC payload scripts legitimately
        // serialize the raw `currentCityName` field — the contract is about
        // rendered text only.
        const renderedText = await page.locator("body").innerText();
        assert(
          !renderedText.includes(FORGED_NAME),
          `${label}: forged currentCityName "${FORGED_NAME}" rendered on /profile (${locale}) — ` +
            `displayCityName must ignore runtimeName for launch ids`,
        );
        await shot(page, SLUG, `profile-city-${locale}`);
        checkErrors();
        return page;
      },
      label,
    );
  }
}

/** Assert one fired /api/search request's scope params. */
function assertSearchScope(url, { city, lat, lng }, label) {
  const params = new URL(url).searchParams;
  const actualCity = params.get("city");
  if (city === null) {
    assert(
      actualCity === null,
      `${label}: /api/search carried ?city=${actualCity} — a runtime city id must scope by coordinates (BRAWUKA-568)`,
    );
  } else {
    assert(actualCity === city, `${label}: /api/search ?city=${actualCity}, want ${city}`);
  }
  for (const [name, want] of [["lat", lat], ["lng", lng]]) {
    const got = params.get(name);
    if (want === null) {
      assert(got === null, `${label}: /api/search carried ?${name}=${got}, want absent`);
    } else {
      assert(
        got !== null && Math.abs(Number(got) - want) < 1e-6,
        `${label}: /api/search ?${name}=${got}, want ${want}`,
      );
    }
  }
}

/** Fire the debounced search and assert the rt-* request + response contract. */
async function assertRtSearch(page, input, label) {
  const rtRequest = page.waitForRequest(
    (req) => req.url().includes("/api/search?"),
    { timeout: 15000 },
  );
  await input.fill("Scope");
  const request = await rtRequest;
  assertSearchScope(request.url(), { city: null, lat: RT_LAT, lng: RT_LNG }, label);

  const response = await page.waitForResponse(
    (res) => res.url() === request.url(),
    { timeout: 15000 },
  );
  const body = await response.json();
  assert(
    body?.reference_point?.is_from_city_center === false &&
      Math.abs(body.reference_point.lat - RT_LAT) < 1e-6 &&
      Math.abs(body.reference_point.lng - RT_LNG) < 1e-6,
    `${label}: reference_point ${JSON.stringify(body?.reference_point)} is not the coordinate anchor`,
  );
  await page.getByText(SCOPE_CAFE_NAME, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
  await shot(page, SLUG, "rt-scope-results");
}

/** Onboarding state as the locate flow persists it (DG121), varying the city pair. */
const rtState = (currentCity, currentCityName = null) => ({
  onboarded: true,
  currentCity,
  currentCityName,
  lastLocation: { lat: RT_LAT, lng: RT_LNG },
});

/** Chip re-render assertions + the launch-id positive control request. */
async function checkChipDisplayNames(page, label) {
  const chip = (text) => page.locator(`button:has-text("${text}")`).first();
  // Persisted runtime name wins for rt-* ids (BRAWUKA-696 display path).
  await writeOnboarding(page, rtState(RT_CITY_ID, "Los Angeles"));
  await chip("Los Angeles").waitFor({ state: "visible", timeout: 15000 });

  // Unknown ids capitalize (no request fires — same coordinate signature).
  await writeOnboarding(page, rtState("lisbon"));
  await chip("Lisbon").waitFor({ state: "visible", timeout: 15000 });

  // Positive control: a launch id must send ?city= on the next request.
  const launchRequest = page.waitForRequest(
    (req) => req.url().includes("/api/search?") && req.url().includes("city="),
    { timeout: 15000 },
  );
  await writeOnboarding(page, rtState("shanghai"));
  const launchReq = await launchRequest;
  assertSearchScope(launchReq.url(), { city: "shanghai", lat: null, lng: null }, label);
}

/**
 * Check 2 — rt-* runtime city scopes search by coordinates, not `?city=`.
 * The chip assertions ride the same page: each store write re-renders the
 * subscribed `CityScopeSelect` value.
 */
async function checkRuntimeSearchScope({ base, dbClient, createContext, attachErrorCollector, label }) {
  // The coordinate-scoped request still resolves `effectiveCity` server-side
  // (DG128 → default 'singapore'), so the visible result must be a
  // Singapore-city cafe — distance is sort-only, never a filter.
  await dbClient.query(
    `insert into cafes (id, name, address, location, city, created_by, tz, gallery)
     values ($1, $2, '1 Scope Way', ST_SetSRID(ST_MakePoint(103.8198, 1.3521), 4326)::geography,
             'Singapore', $3, 'Asia/Singapore', '[]'::jsonb)
     on conflict (id) do update set name = $2, city = 'Singapore'`,
    [SCOPE_CAFE_ID, SCOPE_CAFE_NAME, FORGE_USER_ID],
  );

  await withGateContext(
    SLUG,
    createContext,
    {},
    async (context, consoleLines) => {
      await context.addInitScript(seedOnboarding(rtState(RT_CITY_ID)));
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      const input = page.locator(SEARCH_INPUT).first();
      await input.waitFor({ state: "visible", timeout: 20000 });

      // rt-* + null name → localized country fallback on the scope chip.
      const chip = page.locator('button:has-text("United States")').first();
      await chip.waitFor({ state: "visible", timeout: 15000 });

      await assertRtSearch(page, input, label);
      await checkChipDisplayNames(page, label);

      checkErrors();
      return page;
    },
    label,
  );
}

/**
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {import("pg").Client} options.dbClient live fixture client.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runCityScopeGate({ label, base, dbClient, createContext, attachErrorCollector }) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  clearGateArtifacts(SLUG);
  try {
    await checkProfileCityPrecedence({ base, supabaseUrl, dbClient, createContext, attachErrorCollector, label });
    await checkRuntimeSearchScope({ base, dbClient, createContext, attachErrorCollector, label });
  } finally {
    await dbClient.query(`delete from cafes where id = $1`, [SCOPE_CAFE_ID]).catch(() => {});
    await dbClient.query(`delete from profiles where id = $1`, [FORGE_USER_ID]).catch(() => {});
  }
}
