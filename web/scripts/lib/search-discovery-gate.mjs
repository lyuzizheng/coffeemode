/**
 * Search discovery & geolocation & Turnstile UI gate (BRAWUKA-706).
 *
 * Covers:
 *   - T16 unified search: min-query debounce, signature dedupe on Enter,
 *     rich results view, and view-all deep link.
 *   - T16b ?city= deep link beats localStorage.
 *   - T6 nearby: geolocation allow/deny, and fetch failure error handling.
 *   - T17 UI half: no Turnstile widget when site key is unset, zero requests
 *     to challenges.cloudflare.com, resolved POI passed to create form.
 */
import { assert, shot } from "./gate-assert.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

async function runInGateContext(createContext, attachErrorCollector, label, fn) {
  return withGateContext("search-discovery", createContext, {}, async (context, consoleLines) => {
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);
    await fn(page, context);
    checkErrors();
    return page;
  }, label);
}

function makeMockStats() {
  const dims = {};
  for (const dim of ["wifi", "outlets", "seats", "temp", "coffee", "overall"]) {
    dims[dim] = { sum: 85, n: 1 };
  }
  return {
    n_users: 1,
    n_checkins: 1,
    dims,
    policies: { max_stay: { "3h": 1 } },
    experience_score: 85,
    composite_score: 85,
    updated_at: new Date().toISOString(),
  };
}

async function getSearchBox(page) {
  const input = page.getByRole("searchbox").or(page.locator("input[type='search']")).first();
  await input.waitFor({ state: "visible", timeout: 15000 });
  return input;
}

async function routeMockSearch(context) {
  await context.route("**/api/search*", async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q");
    if (q !== "smoke") return route.continue();

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: "e2e00000-0000-4000-a000-000000000002",
            name: "E2E Smoke Cafe",
            type: "cafe",
            address: "123 Smoke Test Lane",
            distance_m: 500,
            is_from_city_center: false,
            cafe: {
              id: "e2e00000-0000-4000-a000-000000000002",
              name: "E2E Smoke Cafe",
              lat: 35.6762,
              lng: 139.6503,
              address: "123 Smoke Test Lane",
              city: "tokyo",
              tz: "Asia/Tokyo",
              opening_hours: null,
              price_range: 2,
              cover: null,
              maintained_by_service: false,
              visibility: "public",
              work_stats: makeMockStats(),
            },
          },
        ],
        total_count: 1,
        is_weak_results: false,
        reference_point: {
          city_id: "tokyo",
          center: { lat: 35.6762, lng: 139.6503 },
        },
      }),
    });
  });
}

async function checkUnifiedSearch({ base, createContext, attachErrorCollector, stepLabel }) {
  await runInGateContext(createContext, attachErrorCollector, stepLabel, async (page, context) => {
    const capturedSearches = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/search")) capturedSearches.push(req.url());
    });

    await routeMockSearch(context);

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    const searchField = await getSearchBox(page);

    // Sub-min-length (length 2 < 3): zero search requests fired
    await searchField.fill("ab");
    await page.waitForTimeout(500);
    assert(capturedSearches.length === 0, `Sub-min query fired ${capturedSearches.length} request(s)`);

    // Enter on invalid input is a no-op
    await searchField.press("Enter");
    await page.waitForTimeout(500);
    assert(capturedSearches.length === 0, `Enter on invalid input fired ${capturedSearches.length} request(s)`);

    // Enter on valid input: dedupe prevents debounce double-fire (exactly 1 request)
    await searchField.fill("smoke");
    const countBeforeEnter = capturedSearches.length;
    await searchField.press("Enter");
    await page.waitForTimeout(600);
    const enterRequests = capturedSearches.length - countBeforeEnter;
    assert(enterRequests === 1, `Enter on valid query fired ${enterRequests} requests; expected 1`);

    // Submit switches to rich results view
    const resultsContainer = page.locator("ul, [role='list']").first();
    await resultsContainer.waitFor({ state: "visible", timeout: 15000 });

    // View-all deep link is rendered
    const viewAll = page.locator("a[href*='/search?q=smoke'], a:has-text('View all'), a:has-text('查看全部')").first();
    await viewAll.waitFor({ state: "visible", timeout: 10000 });

    await shot(page, "search-discovery", "unified-search");
  });
}

async function checkCityDeepLink({ base, createContext, attachErrorCollector, stepLabel }) {
  await runInGateContext(createContext, attachErrorCollector, stepLabel, async (page) => {
    // Seed localStorage with storedCity "shanghai"
    await page.addInitScript(() => {
      localStorage.setItem("onboarding", JSON.stringify({ currentCity: "shanghai" }));
    });

    // Deep link ?city=tokyo must override storedCity "shanghai" (BRAWUKA-568)
    await page.goto(`${base}/?city=tokyo`, { waitUntil: "domcontentloaded" });
    const field = await getSearchBox(page);

    await field.fill("smoke");
    const [searchRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/search") && res.status() === 200),
      field.press("Enter"),
    ]);

    const wireParams = new URL(searchRes.request().url()).searchParams;
    const wireCity = wireParams.get("city");

    // Separately assert wire param and URL state (URL writer drops ?city= if override is empty)
    assert(
      wireCity === "tokyo",
      `Expected wire query city=tokyo, got "${wireCity}"`,
    );
    const browserUrl = page.url();
    assert(
      browserUrl.includes("city=tokyo"),
      `Expected browser URL to retain city=tokyo, got "${browserUrl}"`,
    );

    await shot(page, "search-discovery", "city-deeplink");
  });
}

async function checkNearbyGeolocation({ base, createContext, attachErrorCollector, stepLabel }) {
  // Allow path
  await withGateContext("search-discovery", createContext, {}, async (context, consoleLines) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 37.7749, longitude: -122.4194 });

    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, `${stepLabel} allow`, { path: "/", status: 200 }, consoleLines);
    const res = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    assert(res?.status() === 200, `Expected 200 for geolocation allow, got ${res?.status()}`);
    const mapSurface = page.locator("canvas.maplibregl-canvas").or(page.getByRole("alert")).first();
    await mapSurface.waitFor({ state: "visible", timeout: 15000 });
    checkErrors();
    return page;
  }, `${stepLabel} allow`);

  // Deny path
  await withGateContext("search-discovery", createContext, {}, async (context, consoleLines) => {
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, `${stepLabel} deny`, { path: "/", status: 200 }, consoleLines);
    const res = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    assert(res?.status() === 200, `Expected 200 for geolocation deny, got ${res?.status()}`);
    checkErrors();
    return page;
  }, `${stepLabel} deny`);

  // Fetch failure renders InlineError + Retry, never empty state (BRAWUKA-231)
  await withGateContext("search-discovery", createContext, {}, async (context, consoleLines) => {
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(
      page,
      `${stepLabel} failure`,
      { path: "/", status: 200, subresources: [{ path: "/api/cafes", status: 500 }] },
      consoleLines,
    );
    await context.route("**/api/cafes?*", (route) => route.fulfill({ status: 500 }));
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });

    const errorAlert = page.locator("[role='alert']").first();
    await errorAlert.waitFor({ state: "visible", timeout: 15000 });
    const retryBtn = page.getByRole("button", { name: /Retry|重试/i }).first();
    await retryBtn.waitFor({ state: "visible", timeout: 5000 });

    const emptyCount = await page.getByText(/No cafes nearby|附近暂无咖啡厅/i).count();
    assert(emptyCount === 0, "Failed fetch rendered empty state instead of InlineError");

    await shot(page, "search-discovery", "nearby-error");
    checkErrors();
    return page;
  }, `${stepLabel} failure`);
}

async function checkTurnstileUiHalf({ base, createContext, attachErrorCollector, stepLabel }) {
  await runInGateContext(createContext, attachErrorCollector, stepLabel, async (page, context) => {
    let cloudflareChallengeCount = 0;
    context.on("request", (req) => {
      if (req.url().includes("challenges.cloudflare.com")) cloudflareChallengeCount += 1;
    });

    await context.route("**/api/places/resolve", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "Resolved E2E POI Cafe",
          address: "500 Howard St, San Francisco, CA",
          lat: 37.7749,
          lng: -122.4194,
          city: "San Francisco",
          place_id: "e2e-poi-resolved-id",
          source: "google",
        }),
      });
    });

    await page.goto(`${base}/?create=1`, { waitUntil: "domcontentloaded" });

    const urlInput = page.locator("input[type='url'], input[placeholder*='maps' i], input[placeholder*='地图' i]").first();
    await urlInput.waitFor({ state: "visible", timeout: 15000 });
    await urlInput.fill("https://maps.app.goo.gl/e2e-test");

    const submitBtn = page.getByRole("button", { name: /Resolve link|解析链接/i }).first();
    await submitBtn.waitFor({ state: "visible", timeout: 5000 });
    await submitBtn.click();

    // Create form receives the resolved POI
    const resolvedName = page
      .locator("input[value='Resolved E2E POI Cafe']")
      .or(page.getByText("Resolved E2E POI Cafe"))
      .first();
    await resolvedName.waitFor({ state: "visible", timeout: 15000 });

    // Assert zero requests to challenges.cloudflare.com
    assert(
      cloudflareChallengeCount === 0,
      `Expected 0 requests to challenges.cloudflare.com, got ${cloudflareChallengeCount}`,
    );

    await shot(page, "search-discovery", "turnstile-ui");
  });
}

/**
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.base
 * @param {Function} options.createContext
 * @param {Function} options.attachErrorCollector
 */
export async function runSearchDiscoveryGate({ label, ...options }) {
  clearGateArtifacts("search-discovery");
  await checkUnifiedSearch({ ...options, stepLabel: `${label} search` });
  await checkCityDeepLink({ ...options, stepLabel: `${label} city-override` });
  await checkNearbyGeolocation({ ...options, stepLabel: `${label} nearby-geo` });
  await checkTurnstileUiHalf({ ...options, stepLabel: `${label} turnstile-ui` });
}
