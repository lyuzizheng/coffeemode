/**
 * Check-in drawer viewport gate (BRAWUKA-217).
 *
 * The drawer's HeroUI Dialog caps at `92dvh`. Its child chain
 * (`CheckinForm` wrapper → `Drawer.Body` → `Drawer.Footer`) therefore has to
 * actually shrink: a flex child left at the default `min-height: auto` refuses
 * to, so `Drawer.Body`'s `overflow-y-auto` never engages and the footer's
 * primary CTA renders past the fold with no scroll path — on every viewport,
 * which blocked the whole check-in loop. This gate opens the real drawer
 * against the standalone build and asserts the settled geometry, because a
 * visibility check (`isVisible`, `toBeVisible`) passes on an off-viewport
 * element: its box is non-empty, it is merely outside the viewport.
 *
 * Split out of `scripts/e2e-smoke.mjs` to keep that runner inside the 400-line
 * file budget.
 */

/**
 * The three viewports BRAWUKA-217 measured: the narrow phone that overflowed the
 * most, the default phone, then the desktop column (18g breakpoint). Narrowest
 * first so a regression fails on the smallest screen it affects.
 */
const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800, isMobile: true },
  { name: "390x844", width: 390, height: 844, isMobile: true },
  { name: "1440x900", width: 1440, height: 900, isMobile: false },
];

const DRAWER_DIALOG_SELECTOR = "section.drawer__dialog--bottom";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Wait for the bottom drawer's slide-in to settle. The panel animates in from
 * below the fold, so a geometry read taken while it is still moving reports a
 * position that never exists at rest. Polls until two consecutive frames agree.
 */
async function waitForSettled(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("section.drawer__dialog--bottom");
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const sample = `${rect.top}|${rect.bottom}`;
      const previous = el.dataset.settleProbe;
      el.dataset.settleProbe = sample;
      return previous === sample;
    },
    null,
    { timeout: 5000 },
  );
}

/**
 * Open the drawer from the cafe page's Check-in CTA and return its dialog.
 * A click landing before hydration is a no-op, so click until the drawer
 * actually mounts rather than trusting the first press.
 */
async function openCheckinDrawer(page) {
  const trigger = page.getByRole("button", { name: /Check in|Check-in|打卡/i }).first();
  await trigger.waitFor({ state: "visible", timeout: 15000 });

  const dialog = page.locator(DRAWER_DIALOG_SELECTOR);
  for (let attempt = 0; attempt < 20 && !(await dialog.isVisible()); attempt++) {
    await trigger.click();
    await dialog.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
  }
  if (!(await dialog.isVisible())) {
    throw new Error("check-in drawer did not open");
  }
  await waitForSettled(page);
  return dialog;
}

async function measureDrawer(dialog) {
  return dialog.evaluate((el) => {
    const body = el.querySelector(".drawer__body");
    const cta = el.querySelector(".drawer__footer button");
    const rect = cta?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      ctaBottom: rect ? Math.round(rect.bottom) : null,
      bodyClientHeight: body?.clientHeight ?? null,
      bodyScrollHeight: body?.scrollHeight ?? null,
    };
  });
}

function assertCtaInsideViewport(viewport, metrics) {
  assert(metrics.ctaBottom !== null, `${viewport.name}: primary CTA not found in the drawer footer`);
  assert(
    metrics.ctaBottom <= metrics.viewportHeight + 1,
    `${viewport.name}: drawer CTA bottom ${metrics.ctaBottom} falls outside the ${metrics.viewportHeight}px viewport`,
  );
  assert(
    metrics.bodyClientHeight !== null && metrics.bodyClientHeight < metrics.bodyScrollHeight,
    `${viewport.name}: drawer body is not a scroll container (${metrics.bodyClientHeight}/${metrics.bodyScrollHeight})`,
  );
}

/**
 * Assert the check-in drawer's primary CTA stays inside the viewport, and that
 * `Drawer.Body` is a real scroll container, at every gated viewport.
 *
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.cafeId   DB-seeded cafe whose page carries the CTA.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runCheckinDrawerGate({ label, base, cafeId, createContext, attachErrorCollector }) {
  for (const viewport of VIEWPORTS) {
    const context = await createContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
    });
    try {
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, `${label} (${viewport.name})`, {
        path: `/cafes/${cafeId}`,
        status: 200,
      });

      await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
      const dialog = await openCheckinDrawer(page);
      assertCtaInsideViewport(viewport, await measureDrawer(dialog));

      checkErrors();
    } finally {
      await context.close();
    }
  }
}
