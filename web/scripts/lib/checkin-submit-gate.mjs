/**
 * Check-in submit flow gate (BRAWUKA-121, artifact §8 e2e coverage).
 *
 * The drawer's own contract sends signed-out sessions to the sign-in gate —
 * a real POST can never leave this browser. So the auth boundary is mocked:
 * `/api/checkins/last` answers "no prior check-in" (which also confirms auth
 * for the drawer) and `POST /api/checkins` returns 201. Everything else —
 * drawer open, overall slider, submit, success card, auto-close, toast, and
 * the feed's `cafe-checkins` refetch — runs against the real standalone
 * build and the seeded cafe page.
 */

const DRAWER_DIALOG_SELECTOR = "section.drawer__dialog--bottom";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Open the drawer, set Overall experience, submit, and assert the success
 * moment, auto-close, toast, and feed invalidation.
 *
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.cafeId   DB-seeded cafe whose page carries the CTA.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runCheckinSubmitGate({ label, base, cafeId, createContext, attachErrorCollector }) {
  const context = await createContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    // Mock the auth boundary only: the last-check-in probe answers "no prior
    // check-in" (a 200 also confirms auth to the drawer, so submit posts
    // instead of opening the sign-in gate) and the POST accepts.
    await context.route("**/api/checkins/last**", (route) =>
      route.fulfill({ status: 200, json: { checkin: null, revisitWindowHours: 24 } }),
    );
    await context.route("**/api/checkins", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 201,
        json: { checkinId: "e2e00000-0000-4000-a000-000000000099" },
      });
    });

    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, label, {
      path: `/cafes/${cafeId}`,
      status: 200,
    });

    // Count feed fetches: the submit must invalidate ["cafe-checkins"], so
    // the mounted feed refetches after the initial load.
    let feedFetches = 0;
    page.on("request", (req) => {
      if (req.url().includes(`/api/cafes/${cafeId}/checkins`)) feedFetches += 1;
    });

    await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });

    const trigger = page.getByRole("button", { name: /Check in|Check-in|打卡/i }).first();
    await trigger.waitFor({ state: "visible", timeout: 15000 });
    const dialog = page.locator(DRAWER_DIALOG_SELECTOR);
    for (let attempt = 0; attempt < 20 && !(await dialog.isVisible()); attempt++) {
      await trigger.click();
      await dialog.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
    }
    assert(await dialog.isVisible(), "check-in drawer did not open");

    // Set the required overall slider via its keyboard contract (End = 100),
    // then submit from the drawer footer.
    const overall = dialog.getByRole("slider", { name: /Overall experience|整体体验/i });
    await overall.focus();
    await overall.press("End");
    const submit = dialog.getByRole("button", { name: /^Check in$|^打卡$/i });
    await submit.click();

    // Success moment: the card shows, then the drawer auto-closes (900ms
    // dwell) and the toast confirms.
    await page.getByText(/Checked in|已打卡/i).waitFor({ state: "visible", timeout: 5000 });
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    await page.getByText(/Check-in saved|打卡成功/i).waitFor({ state: "visible", timeout: 5000 });

    assert(feedFetches >= 2, `expected the check-in feed to refetch after submit, saw ${feedFetches} fetch(es)`);

    checkErrors();
  } finally {
    await context.close();
  }
}
