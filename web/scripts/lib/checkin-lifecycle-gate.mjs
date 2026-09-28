/**
 * Check-in lifecycle gate (BRAWUKA-705, T9/T10/T11).
 *
 * Three API-level lifecycles against the fixture cafe, plus one UI entry
 * proof — all self-cleaning via fixture teardown or explicit deletes:
 *
 *   T11 like: like/unlike user2's check-in (S1 fixture row), count syncs
 *     both ways; self-like on the own check-in → 403
 *     `self_like_forbidden`. Runs first so the later delete cannot remove
 *     its target.
 *   T9 edit: PATCH score/note on the own check-in via `context.request`,
 *     then the cafe page feed shows the edited note; the overflow menu
 *     (the only edit entry — `owned_by_viewer` gated, BRAWUKA-120) opens
 *     the edit drawer with Save/Delete controls.
 *   T9-photo: intent pre-check runs before any remote work, so an unissued
 *     `add_photo_ids` fails closed with 422 `invalid_photos` and a
 *     non-member `remove_photo_ids` is a no-op success — both without the
 *     image service (proves the BRAWUKA-563 delta path parses).
 *   T10 delete: DELETE the own check-in → gone from the feed; gallery
 *     follows via the same read (fixture rows have empty galleries).
 */


import { DRAWER_DIALOG_SELECTOR, assert, shot } from "./gate-assert.mjs";
import { assertSessionLanded, mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

const EDITED_NOTE = "Edited by the T9 lifecycle gate.";

function apiHeaders(base) {
  return { Origin: base, "content-type": "application/json" };
}

async function ownCheckinId(dbClient, userId, cafeId) {
  const { rows } = await dbClient.query(
    `select id from checkins where user_id = $1 and cafe_id = $2 and deleted_at is null limit 1`,
    [userId, cafeId],
  );
  return rows[0]?.id ?? null;
}

async function foreignCheckinId(dbClient, userId, cafeId) {
  const { rows } = await dbClient.query(
    `select id from checkins where user_id <> $1 and cafe_id = $2 and deleted_at is null limit 1`,
    [userId, cafeId],
  );
  return rows[0]?.id ?? null;
}

async function checkLikeToggle({ request, base, dbClient, userId, cafeId, label }) {
  const targetId = await foreignCheckinId(dbClient, userId, cafeId);
  assert(targetId, `${label}: no foreign check-in at the fixture cafe for the like toggle`);

  const liked = await request.post(`${base}/api/checkins/${targetId}/like`, {
    headers: { Origin: base },
  });
  assert(liked.status() === 200, `like returned ${liked.status()}, want 200`);
  const likedBody = await liked.json();
  assert(likedBody.liked === true, `like did not set liked=true: ${JSON.stringify(likedBody)}`);

  const unliked = await request.post(`${base}/api/checkins/${targetId}/like`, {
    headers: { Origin: base },
  });
  assert(unliked.status() === 200, `unlike returned ${unliked.status()}, want 200`);
  const unlikedBody = await unliked.json();
  assert(
    unlikedBody.liked === false && unlikedBody.likes_count === likedBody.likes_count - 1,
    `unlike did not sync the count: ${JSON.stringify(unlikedBody)} vs ${JSON.stringify(likedBody)}`,
  );

  const ownId = await ownCheckinId(dbClient, userId, cafeId);
  assert(ownId, `${label}: no own check-in at the fixture cafe for the self-like check`);
  const selfRes = await request.post(`${base}/api/checkins/${ownId}/like`, {
    headers: { Origin: base },
  });
  assert(selfRes.status() === 403, `self-like returned ${selfRes.status()}, want 403`);
  const selfBody = await selfRes.json();
  assert(
    selfBody.error === "self_like_forbidden",
    `self-like error was ${selfBody.error}, want self_like_forbidden`,
  );
}

async function checkEditFlow({ request, base, page, dbClient, userId, cafeId, label }) {
  const targetId = await ownCheckinId(dbClient, userId, cafeId);
  assert(targetId, `${label}: no own check-in at the fixture cafe to edit`);

  const patched = await request.patch(`${base}/api/checkins/${targetId}`, {
    headers: apiHeaders(base),
    data: { note: EDITED_NOTE, scores: { overall: 77 } },
  });
  assert(patched.status() === 200, `PATCH check-in returned ${patched.status()}, want 200`);

  // BRAWUKA-563 photo delta without the image service: an unissued id
  // fails closed (422), a non-member remove is a no-op success.
  const badPhoto = await request.patch(`${base}/api/checkins/${targetId}`, {
    headers: apiHeaders(base),
    data: { add_photo_ids: [crypto.randomUUID()] },
  });
  assert(badPhoto.status() === 422, `unissued add_photo_ids returned ${badPhoto.status()}, want 422`);
  const noopRemove = await request.patch(`${base}/api/checkins/${targetId}`, {
    headers: apiHeaders(base),
    data: { remove_photo_ids: [crypto.randomUUID()] },
  });
  assert(noopRemove.status() === 200, `remove of a non-member photo returned ${noopRemove.status()}`);

  // Feed reflects the edit.
  await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
  await page.getByText(EDITED_NOTE, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });

  // The only edit entry: the own-card overflow menu opens the drawer with
  // Save changes + Delete check-in controls (BRAWUKA-120).
  const menu = page.getByRole("button", { name: /More actions for this check-in/i }).first();
  await menu.waitFor({ state: "visible", timeout: 15000 });
  await menu.click();
  const editItem = page.getByRole("menuitem").first();
  await editItem.waitFor({ state: "visible", timeout: 10000 });
  await editItem.click();
  const dialog = page.locator(DRAWER_DIALOG_SELECTOR);
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  assert(
    (await page.getByRole("button", { name: /Save changes/i }).count()) > 0,
    "edit drawer has no Save changes control",
  );
  assert(
    (await page.getByRole("button", { name: /Delete check-in/i }).count()) > 0,
    "edit drawer has no Delete check-in control",
  );
  await shot(page, "checkin-lifecycle", "edit-drawer");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  return targetId;
}

async function checkDeleteFlow({ request, base, page, targetId, cafeId, label }) {
  const deleted = await request.delete(`${base}/api/checkins/${targetId}`, {
    headers: { Origin: base },
  });
  assert(deleted.status() === 200, `DELETE check-in returned ${deleted.status()}, want 200`);

  await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const body = await page.textContent("body");
  assert(!body.includes(EDITED_NOTE), "deleted check-in note still rendered in the feed");

  const feedRes = await request.get(`${base}/api/cafes/${cafeId}/checkins`, {
    headers: { Origin: base },
  });
  assert(feedRes.status() === 200, `feed fetch returned ${feedRes.status()}, want 200`);
  assert(
    !JSON.stringify(await feedRes.json()).includes(EDITED_NOTE),
    "deleted check-in still present in the feed API",
  );
  await shot(page, "checkin-lifecycle", "deleted");
  void label;
}

/**
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.cafeId   DB-seeded cafe id.
 * @param {string} options.userId   DB-seeded profile id the session maps to.
 * @param {import("pg").Client} options.dbClient live fixture client.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runCheckinLifecycleGate({
  label,
  base,
  cafeId,
  userId,
  dbClient,
  createContext,
  attachErrorCollector,
}) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  clearGateArtifacts("checkin-lifecycle");
  const sessionCookie = await mintSession(supabaseUrl, userId);
  if (!sessionCookie) {
    if (process.env.CI) {
      throw new Error(`${label}: supabase-mock unreachable at ${supabaseUrl}`);
    }
    console.warn(
      `[E2E] SKIP ${label}: supabase-mock unreachable at ${supabaseUrl} — start it with \`docker compose up -d supabase-mock\``,
    );
    return;
  }

  // Serial within one traced context would keep the deleted row deleted
  // for the UI steps — instead drive request + page in one context so the
  // feed assertions see the same session, and let fixture setup of the
  // NEXT run re-seed the deleted own check-in (idempotent upsert).
  await withGateContext(
    "checkin-lifecycle",
    createContext,
    {},
    async (context, consoleLines) => {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      await assertSessionLanded({ base, supabaseUrl, request: context.request, label });
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: `/cafes/${cafeId}`, status: 200 }, consoleLines);

      await checkLikeToggle({ request: context.request, base, dbClient, userId, cafeId, label });
      const targetId = await checkEditFlow({
        request: context.request,
        base,
        page,
        dbClient,
        userId,
        cafeId,
        label,
      });
      await checkDeleteFlow({ request: context.request, base, page, targetId, cafeId, label });

      checkErrors();
      return page;
    },
    label,
  );
}
