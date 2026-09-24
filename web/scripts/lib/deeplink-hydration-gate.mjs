/**
 * DG124 deep-link hydration gate (BRAWUKA-514).
 *
 * `/cafes/[id]` is the app entry: first paint is the SSR shell, then the page
 * hydrates in place into the map app with the cafe at FULL — no route change,
 * no DeepLinkBanner, no welcome card. These three checks prove the contract
 * against the standalone build:
 *
 *   1. Desktop: the discovery sidebar + detail column mount, the SSR
 *      masthead overlay unmounts, the URL stays canonical, and no welcome
 *      card renders (DG124/DG112).
 *   2. Mobile: the sheet lands at FULL (`data-sheet-snap`) and a handle
 *      drag-down steps FULL → HALF (DG14/DG15 detent contract).
 *   3. The retired `/?cafe=[id]` entry 301-redirects to `/cafes/[id]` and
 *      hydrates identically.
 *
 * Split out of `scripts/e2e-smoke.mjs` to keep that runner inside the
 * 400-line file budget.
 */
import { assert, shot } from "./gate-assert.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

async function checkDesktopHydration({ base, cafeId, cafeName, createContext, attachErrorCollector, stepLabel }) {
  await withGateContext("deeplink-hydration", createContext, {}, async (context, consoleLines) => {
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, stepLabel, {
      path: `/cafes/${cafeId}`,
      status: 200,
    }, consoleLines);

    const res = await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
    assert(res?.status() === 200, `Expected 200 for seeded cafe, got ${res?.status()}`);

    // Hydrated app state: the discovery sidebar + detail column are live and
    // the SSR masthead overlay is gone — the shell became the app in place.
    await page.locator("aside").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("heading", { name: cafeName }).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForSelector("header", { state: "detached", timeout: 10000 });
    assert(page.url().endsWith(`/cafes/${cafeId}`), `URL drifted: ${page.url()}`);

    // No welcome card / banner on deep-link arrivals (DG124/DG112).
    assert(
      (await page.getByText("Find a cafe you can actually work in").count()) === 0,
      "Welcome card rendered on a deep-link arrival",
    );

    // The map materializes behind the content (stubbed tiles): canvas or the
    // designed error state — either proves the app mounted.
    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    const mapError = page.getByRole("alert");
    await mapCanvas.or(mapError).first().waitFor({ state: "visible", timeout: 20000 });
    await shot(page, "deeplink-hydration", "desktop");

    checkErrors();
    return page;
  }, stepLabel);
}

async function checkMobileDetents({ base, cafeId, createContext, attachErrorCollector, stepLabel }) {
  await withGateContext(
    "deeplink-hydration",
    createContext,
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    async (context, consoleLines) => {
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, stepLabel, {
        path: `/cafes/${cafeId}`,
        status: 200,
      }, consoleLines);

      const res = await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
      assert(res?.status() === 200, `Expected 200 for seeded cafe, got ${res?.status()}`);

      // Hydration lands the sheet at FULL (the shell became the sheet).
      await page.waitForFunction(() => document.documentElement.dataset.sheetSnap === "full", {
        timeout: 20000,
      });

      // Drag the handle down past the step threshold → HALF.
      const handle = page.locator("[aria-label='Drag to resize the panel']");
      await handle.waitFor({ state: "visible", timeout: 10000 });
      const box = await handle.boundingBox();
      assert(box, "sheet handle has no box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 10 });
      await page.mouse.up();
      await page.waitForFunction(() => document.documentElement.dataset.sheetSnap === "half", {
        timeout: 10000,
      });
      await shot(page, "deeplink-hydration", "mobile-half");

      checkErrors();
      return page;
    },
    stepLabel,
  );
}

async function checkLegacyRedirect({ base, cafeId, createContext, attachErrorCollector, stepLabel }) {
  await withGateContext("deeplink-hydration", createContext, {}, async (context, consoleLines) => {
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, stepLabel, {
      path: `/cafes/${cafeId}`,
      status: 200,
    }, consoleLines);

    const res = await page.goto(`${base}/?cafe=${cafeId}`, { waitUntil: "domcontentloaded" });
    assert(res?.status() === 200, `Expected 200 after redirect, got ${res?.status()}`);
    assert(
      page.url().endsWith(`/cafes/${cafeId}`),
      `Expected redirect to /cafes/${cafeId}, landed on ${page.url()}`,
    );
    // The redirected entry hydrates into the app like the canonical one.
    await page.locator("aside").first().waitFor({ state: "visible", timeout: 20000 });
    checkErrors();
    return page;
  }, stepLabel);
}

/**
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.cafeId   DB-seeded cafe id.
 * @param {string} options.cafeName seeded cafe's display name.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runDeeplinkHydrationGate({ label, ...options }) {
  clearGateArtifacts("deeplink-hydration");
  await checkDesktopHydration({ ...options, stepLabel: `${label} desktop` });
  await checkMobileDetents({ ...options, stepLabel: `${label} mobile` });
  await checkLegacyRedirect({ ...options, stepLabel: `${label} redirect` });
}
