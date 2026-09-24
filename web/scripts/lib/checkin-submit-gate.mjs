/**
 * Check-in submit flow gate (BRAWUKA-121, artifact §8 e2e coverage).
 *
 * Signs in for real against the supabase-mock (compose service, :54321):
 * `/auth/v1/token` accepts any credentials and returns a fake JWT the app's
 * server session check validates via `/auth/v1/user`. The session cookie is
 * the @supabase/ssr `base64-`-prefixed JSON shape (`sb-<host>-auth-token`).
 * Everything else — drawer open, overall slider, submit, success card,
 * auto-close, toast, and the feed's `cafe-checkins` refetch — runs against
 * the real standalone build and the seeded cafe page. The POST hits the real
 * API and writes to the test database (fixture cleanup removes it).
 *
 * DG124 note: the cafe page now hydrates into the map app, where
 * `isAuthenticated` comes from the server session — the old probe-mock trick
 * (a 200 on /api/checkins/last standing in for auth) can no longer simulate
 * a signed-in user, so the session must be real.
 */

import { DRAWER_DIALOG_SELECTOR, assert, shot } from "./gate-assert.mjs";
import { assertSessionLanded, mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

/**
 * Wait out the SSR shell overlay, open the check-in drawer from the app's
 * CTA, set the required overall slider (End = 100), and submit.
 */
async function openDrawerAndSubmit(page) {
  // DG124: the SSR shell is a hydration overlay — its own Check-in CTA is
  // live before the app mounts, and the overlay unmounts once hydration
  // lands. A drawer opened from the shell dies with it, so wait for the
  // masthead to detach before touching any CTA.
  await page.waitForSelector("header", { state: "detached", timeout: 15000 });

  const trigger = page.getByRole("button", { name: /Check in|Check-in|打卡/i }).first();
  await trigger.waitFor({ state: "visible", timeout: 15000 });
  const dialog = page.locator(DRAWER_DIALOG_SELECTOR);
  for (let attempt = 0; attempt < 20 && !(await dialog.isVisible()); attempt++) {
    await trigger.click();
    await dialog.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
  }
  assert(await dialog.isVisible(), "check-in drawer did not open");

  const overall = dialog.getByRole("slider", { name: /Overall experience|整体体验/i });
  await overall.focus();
  await overall.press("End");
  await dialog.getByRole("button", { name: /^Check in$|^打卡$/i }).click();
  return dialog;
}

/**
 * Open the drawer, set Overall experience, submit, and assert the success
 * moment, auto-close, toast, and feed invalidation.
 *
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.cafeId   DB-seeded cafe whose page carries the CTA.
 * @param {string} options.userId   DB-seeded profile id the session maps to.
 * @param {import("pg").Client} options.dbClient live fixture client — the
 *   seeded check-in for (userId, cafeId) is deleted so the drawer opens in
 *   create mode; fixture cleanup removes the row this gate creates.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runCheckinSubmitGate({
  label,
  base,
  cafeId,
  userId,
  dbClient,
  createContext,
  attachErrorCollector,
}) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  // Clear before the mock-miss skip below, so a skipped run never presents
  // a previous run's directory as fresh output (the suite wipe covers the rest).
  clearGateArtifacts("checkin-submit");
  const sessionCookie = await mintSession(supabaseUrl, userId);
  if (!sessionCookie) {
    // CI must never mask a red gate behind a warn — the compose step makes
    // the mock reachable, so a miss there is a real failure.
    if (process.env.CI) {
      throw new Error(`${label}: supabase-mock unreachable at ${supabaseUrl}`);
    }
    console.warn(
      `[E2E] SKIP ${label}: supabase-mock unreachable at ${supabaseUrl} — start it with \`docker compose up -d supabase-mock\``,
    );
    return;
  }

  // The fixture seeds a check-in by this user at this cafe, which would open
  // the drawer in edit mode. Remove it so the create-mode contract is what
  // gets exercised; cleanup deletes whatever this gate writes.
  await dbClient.query(`delete from checkins where user_id = $1 and cafe_id = $2`, [userId, cafeId]);

  await withGateContext(
    "checkin-submit",
    createContext,
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    async (context, consoleLines) => {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      // Fail fast when the cookie name derived from E2E_SUPABASE_URL does not
      // match the app's session read — otherwise the gate runs anonymously
      // and fails late at an unrelated assertion.
      await assertSessionLanded({ base, supabaseUrl, request: context.request, label });

      const page = await context.newPage();
      const checkErrors = attachErrorCollector(
        page,
        label,
        { path: `/cafes/${cafeId}`, status: 200 },
        consoleLines,
      );

      // Count feed fetches: the submit must invalidate ["cafe-checkins"], so
      // the mounted feed refetches after the initial load.
      let feedFetches = 0;
      page.on("request", (req) => {
        if (req.url().includes(`/api/cafes/${cafeId}/checkins`)) feedFetches += 1;
      });

      await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
      const dialog = await openDrawerAndSubmit(page);

      // Success moment: the card shows, then the drawer auto-closes (900ms
      // dwell) and the toast confirms.
      await page.getByText(/Checked in|已打卡/i).waitFor({ state: "visible", timeout: 5000 });
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      await page.getByText(/Check-in saved|打卡成功/i).waitFor({ state: "visible", timeout: 5000 });

      assert(
        feedFetches >= 2,
        `expected the check-in feed to refetch after submit, saw ${feedFetches} fetch(es)`,
      );
      await shot(page, "checkin-submit", "success");

      checkErrors();
      return page;
    },
    label,
  );
}
