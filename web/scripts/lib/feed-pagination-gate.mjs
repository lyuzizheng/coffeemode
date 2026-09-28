/**
 * Check-in feed pagination & mode switch & cursor recovery gate (BRAWUKA-706).
 *
 * Covers T12:
 *   - Newest / Helpful mode switch with stale-while-revalidate behavior.
 *   - Cursor pagination self-heal (BRAWUKA-442 / BRAWUKA-462):
 *     Intercepts the feed request with a cursor, rewrites/responds with 410
 *     cursor_version_expired, and asserts the client automatically refetches
 *     from page one without a cursor.
 */
import { assert, shot } from "./gate-assert.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

async function checkModeSwitch(page, cafeId) {
  const helpfulTab = page.getByRole("tab", { name: /Helpful|高分/i }).first();
  const newestTab = page.getByRole("tab", { name: /Newest|最新/i }).first();
  await helpfulTab.waitFor({ state: "visible", timeout: 15000 });

  // Switch to Helpful (network request fired for new mode)
  const [helpfulRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/cafes/${cafeId}/checkins`) && r.url().includes("mode=helpful")),
    helpfulTab.click(),
  ]);
  assert(helpfulRes.status() === 200, `Helpful mode returned ${helpfulRes.status()}`);
  assert((await helpfulTab.getAttribute("aria-selected")) === "true", "Helpful tab not selected");

  // Switch back to Newest (stale-while-revalidate: served from memory cache immediately)
  await newestTab.click();
  await page.waitForFunction(
    () => document.querySelector("[role='tab'][aria-selected='true']")?.textContent?.match(/Newest|最新/),
    { timeout: 5000 },
  );
  assert((await newestTab.getAttribute("aria-selected")) === "true", "Newest tab not selected");
}

async function setupCursorRoute(context, cafeId, state) {
  await context.route(`**/api/cafes/${cafeId}/checkins*`, async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");

    if (cursor === "synthetic-expired-cursor") {
      state.cursorFired = true;
      // BRAWUKA-442: cursor request hits 410 cursor_version_expired.
      // Envelope mirrors apiError(): code is a string, message prose rides
      // alongside (the client keys on status only — BRAWUKA-706 review P2).
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({
          error: "cursor_version_expired",
          message: "snapshot version expired; restart from page one",
        }),
      });
      return;
    }

    const res = await route.fetch();
    const data = await res.json();
    if (!state.cursorFired) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...data,
          next_cursor: "synthetic-expired-cursor",
        }),
      });
    } else {
      state.recoveryFired = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    }
  });
}

async function checkCursorRecovery({ base, cafeId, createContext, attachErrorCollector, stepLabel }) {
  await withGateContext("feed-pagination", createContext, {}, async (context, consoleLines) => {
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(
      page,
      stepLabel,
      { path: `/cafes/${cafeId}`, status: 200, subresources: [{ path: "/checkins", status: 410 }] },
      consoleLines,
    );

    const state = { cursorFired: false, recoveryFired: false };
    await setupCursorRoute(context, cafeId, state);

    // Set up waiters before navigation so auto-triggered pagination on initial view is caught
    const cursorPromise = page.waitForResponse(
      (r) => r.url().includes("cursor=synthetic-expired-cursor") && r.status() === 410,
      { timeout: 20000 },
    );
    const recoveryPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/cafes/${cafeId}/checkins`) &&
        !r.url().includes("cursor=") &&
        r.status() === 200 &&
        state.cursorFired,
      { timeout: 20000 },
    );

    await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });

    // Wait for the feed to render the first page
    const sentinel = page.locator("section div[aria-hidden].h-px").last();
    await sentinel.waitFor({ state: "attached", timeout: 15000 });

    // Trigger infinite scroll to request the second page with synthetic cursor
    await sentinel.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for cursor 410 and automatic recovery refetch
    await cursorPromise;
    await recoveryPromise;

    assert(state.cursorFired, "Cursor request was never dispatched by the client");
    assert(state.recoveryFired, "Recovery request from page one was never dispatched");

    // Mode switch verification (after recovery has settled)
    await checkModeSwitch(page, cafeId);

    await shot(page, "feed-pagination", "feed-recovered");
    checkErrors();
    return page;
  }, stepLabel);
}

/**
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.base
 * @param {string} options.cafeId
 * @param {Function} options.createContext
 * @param {Function} options.attachErrorCollector
 */
export async function runFeedPaginationGate({ label, ...options }) {
  clearGateArtifacts("feed-pagination");
  await checkCursorRecovery({ ...options, stepLabel: `${label} pagination-self-heal` });
}
