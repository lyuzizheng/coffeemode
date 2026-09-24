/**
 * Cafe creation gate (BRAWUKA-705, T5): search POI → create → detail page.
 *
 * Photo provisioning has two legs: the intent pre-check against
 * `image_upload_intents` (fast, local), then the image-service + sharp
 * processing (absent in e2e — the standalone server has no
 * `IMAGE_SERVICE_URL`, so `getEnv()` throws before any intent is
 * consumed, surfacing as 500 `internal_error`). The gate therefore seeds
 * one intent row for a fresh image UUID and asserts both contracts: an
 * unissued id fails closed with 422 `invalid_photos` (nothing written),
 * and the seeded id passes the intent leg — 201 when the image service
 * answers, 500 while it is absent.
 *
 * POI search hits the real `/api/places/search` (stored-only path). With
 * no POI service configured it answers 502 `poi_service` — the gate
 * asserts that contract, then creates with plain coords (no place refs, so
 * no verification leg) and asserts the detail page renders the new cafe.
 * Cleanup deletes the created cafe (plus its check-in via cascade); the
 * fixture cafe is never touched.
 */

import { assert, shot } from "./gate-assert.mjs";
import { assertSessionLanded, mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

function creationBody(photoId) {
  return {
    name: "E2E Gate Cafe",
    lat: 37.7751,
    lng: -122.4196,
    address: "9 Gate Test Lane",
    city: "San Francisco",
    checkin: {
      scores: { overall: 80, wifi: 85 },
      max_stay: "2h",
      note: "Created by the T5 creation gate.",
      photo_ids: [photoId],
    },
  };
}

async function postCafe(request, base, photoId) {
  return request.post(`${base}/api/cafes`, {
    headers: { Origin: base, "content-type": "application/json" },
    data: creationBody(photoId),
  });
}

async function checkPoiSearch(request, base) {
  const res = await request.get(
    `${base}/api/places/search?q=E2E%20Gate&lat=37.7751&lng=-122.4196`,
    { headers: { Origin: base } },
  );
  // No POI service in e2e: transport failure maps to 502 `poi_service`
  // (poi-client throws POIServiceError(502); the route boundary passes it
  // through). 200 stays accepted for environments where it is configured.
  assert(
    res.status() === 200 || res.status() === 502,
    `POI search returned unexpected status ${res.status()}`,
  );
  if (res.status() === 502) {
    const body = await res.json().catch(() => ({}));
    assert(body.error === "poi_service", `POI 502 error was ${body.error}, want poi_service`);
  }
}

async function checkUnissuedFails(request, base) {
  const res = await postCafe(request, base, crypto.randomUUID());
  assert(res.status() === 422, `unissued photo_ids returned ${res.status()}, want 422`);
  const body = await res.json().catch(() => ({}));
  assert(body.error === "invalid_photos", `unissued photo error was ${body.error}, want invalid_photos`);
}

async function checkSeededCreate(request, base, label, photoId) {
  const res = await postCafe(request, base, photoId);
  if (res.status() === 201) return (await res.json()).cafe_id;
  const body = await res.json().catch(() => ({}));
  assert(
    res.status() === 500 && body.error === "internal_error",
    `seeded create returned ${res.status()} ${JSON.stringify(body).slice(0, 120)}`,
  );
  console.warn(`[E2E] ${label}: image service absent — intent leg passed, creation stops at 500`);
  return null;
}

async function checkDetailPage(page, base, cafeId) {
  if (!cafeId) {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await shot(page, "cafe-creation", "contracts");
    return;
  }
  await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("E2E Gate Cafe", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
  await shot(page, "cafe-creation", "detail");
}

async function driveCreation(ctx) {
  const { label, base, createContext, attachErrorCollector, supabaseUrl, sessionCookie, photoId } = ctx;
  let cafeId = null;
  await withGateContext(
    "cafe-creation",
    createContext,
    {},
    async (context, consoleLines) => {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      await assertSessionLanded({ base, supabaseUrl, request: context.request, label });
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);
      await checkPoiSearch(context.request, base);
      await checkUnissuedFails(context.request, base);
      cafeId = await checkSeededCreate(context.request, base, label, photoId);
      await checkDetailPage(page, base, cafeId);
      checkErrors();
      return page;
    },
    label,
  );
  return cafeId;
}

async function cleanupCreation(ctx, cafeId) {
  const { dbClient, userId, photoId } = ctx;
  if (cafeId) {
    await dbClient.query(`delete from cafes where id = $1`, [cafeId]).catch(() => {});
  }
  await dbClient.query(`delete from image_upload_intents where image_uuid = $1`, [photoId]).catch(() => {});
  await dbClient.query(`delete from cafes where name = 'E2E Gate Cafe' and created_by = $1`, [userId]).catch(() => {});
}

/**
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.userId   DB-seeded profile id the session maps to.
 * @param {import("pg").Client} options.dbClient live fixture client.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runCafeCreationGate({
  label,
  base,
  userId,
  dbClient,
  createContext,
  attachErrorCollector,
}) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  clearGateArtifacts("cafe-creation");
  const sessionCookie = await mintSession(supabaseUrl, userId);
  if (!sessionCookie) {
    if (process.env.CI) {
      throw new Error(`${label}: supabase-mock unreachable at ${supabaseUrl}`);
    }
    console.warn(`[E2E] SKIP ${label}: supabase-mock unreachable at ${supabaseUrl}`);
    return;
  }
  const photoId = crypto.randomUUID();
  await dbClient.query(`insert into image_upload_intents (image_uuid, user_id) values ($1, $2)`, [
    photoId,
    userId,
  ]);
  const ctx = {
    label,
    base,
    userId,
    dbClient,
    createContext,
    attachErrorCollector,
    supabaseUrl,
    sessionCookie,
    photoId,
  };
  let cafeId = null;
  try {
    cafeId = await driveCreation(ctx);
  } finally {
    await cleanupCreation(ctx, cafeId);
  }
}
