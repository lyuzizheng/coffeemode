/**
 * Cafe owner controls gate (BRAWUKA-706).
 *
 * Covers T25:
 *   - Visibility toggle (public ↔ private).
 *   - "仅你可见" / "Only you can see this" badge rendering on private state.
 *   - Delete entry and confirmation dialog cancelation.
 *   - Self-cleaning: restores public visibility on exit.
 */
import { assert, shot } from "./gate-assert.mjs";
import { assertSessionLanded, mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

async function toggleVisibilitySwitch(page, switchLocator, cafeId) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/cafes/${cafeId}/visibility`) && r.request().method() === "PATCH"),
    switchLocator.click(),
  ]);
  assert(res.status() === 200, `PATCH visibility returned ${res.status()}`);
}

/**
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.base
 * @param {string} options.cafeId
 * @param {string} options.userId
 * @param {import("pg").Client} options.dbClient
 * @param {Function} options.createContext
 * @param {Function} options.attachErrorCollector
 */
export async function runOwnerControlsGate({
  label,
  base,
  cafeId,
  userId,
  dbClient,
  createContext,
  attachErrorCollector,
}) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  clearGateArtifacts("owner-controls");

  const sessionCookie = await mintSession(supabaseUrl, userId);
  if (!sessionCookie) {
    if (process.env.CI) {
      throw new Error(`${label}: supabase-mock unreachable at ${supabaseUrl}`);
    }
    console.warn(`[E2E] SKIP ${label}: supabase-mock unreachable at ${supabaseUrl}`);
    return;
  }

  try {
    await withGateContext("owner-controls", createContext, {}, async (sessionCtx, errorLogs) => {
      const authCookie = { ...sessionCookie, url: base };
      await sessionCtx.addCookies([authCookie]);
      await assertSessionLanded({ base, supabaseUrl, request: sessionCtx.request, label });

      const page = await sessionCtx.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: `/cafes/${cafeId}`, status: 200 }, errorLogs);

      await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });

      // Owner controls section mounted for the cafe owner
      const switchLocator = page
        .locator("section[aria-label*='cafe' i], section[aria-label*='咖啡厅' i]")
        .getByRole("switch")
        .or(page.getByRole("switch"))
        .first();
      await switchLocator.waitFor({ state: "visible", timeout: 15000 });

      // 1. Initial state: public, no private badge
      const privateBadge = page.locator("span").filter({ hasText: /仅你可见|Only you can see this/i }).first();
      assert((await privateBadge.count()) === 0, "Private badge initially rendered for public cafe");

      // 2. Toggle to private
      await toggleVisibilitySwitch(page, switchLocator, cafeId);
      await privateBadge.waitFor({ state: "visible", timeout: 10000 });
      assert(await privateBadge.isVisible(), "Private badge not visible after toggle to private");

      // 3. Toggle back to public
      await toggleVisibilitySwitch(page, switchLocator, cafeId);
      await privateBadge.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
      assert((await privateBadge.count()) === 0, "Private badge still visible after toggle to public");

      // 4. Delete entry verification
      const deleteBtn = page.getByRole("button", { name: /^Delete$|^删除$/i }).first();
      await deleteBtn.waitFor({ state: "visible", timeout: 10000 });
      await deleteBtn.click();

      // Confirm box appears with cancel option
      const cancelBtn = page.getByRole("button", { name: /^Cancel$|^取消$/i }).first();
      await cancelBtn.waitFor({ state: "visible", timeout: 5000 });
      await cancelBtn.click();
      await deleteBtn.waitFor({ state: "visible", timeout: 5000 });

      await shot(page, "owner-controls", "owner-controls");
      checkErrors();
      return page;
    }, label);
  } finally {
    if (dbClient) {
      try {
        await dbClient.query("update cafes set visibility = 'public' where id = $1", [cafeId]);
      } catch {
        // Benign: best-effort visibility restore during teardown
      }
    }
  }
}
