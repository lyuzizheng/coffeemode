/**
 * Verified-user handoff browser gate (BRAWUKA-723 / BRAWUKA-750).
 *
 * Renders the REAL `/cafes/[id]` page in a real browser with a real
 * Unicode session and asserts the rendered cafe content plus the
 * authenticated state — the evidence a Vitest replay cannot supply:
 *
 *   1. Chinese session (李明): cafe name heading renders, the account
 *      affordance shows the signed-in initial, no ByteString crash.
 *   2. Emoji session (☕ Nomad): same page, same assertions.
 *   3. Oversized + refresh: the expired session carries the marked
 *      oversized refresh token; the mock serves the reviewer-recipe CJK
 *      metadata on /user for the refreshed bearer alone, the proxy
 *      verifies on a small bearer, skips the over-budget header, rotates
 *      the cookies, and the page recovers the signed-in viewer through its
 *      own getUser() retry — cafe content renders authenticated.
 * Sessions are minted as small bearers (like real GoTrue); the Unicode
 * display name rides the bearer claims the mock serves on /user, and the
 * oversized case stages via the marked refresh token. The cafe navigation
 * itself performs the rotation: no authenticated probe precedes it (such a
 * probe would consume the expired cookie first and let a later request
 * look rotated), and the gate asserts the oversized metadata was actually
 * served plus the rotation landed on that same navigation.
 */
import { assert, shot } from "./gate-assert.mjs";
import { mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";
import { fakeJwt } from "../../../scripts/fake-jwt.mjs";

/**
 * Mint a session whose /user carries the given provider metadata.
 * The mock serves JWT user_metadata claims on /user (like GoTrue), so the
 * name travels the production verify → forward path.
 */
async function mintUnicodeSession(supabaseUrl, userId, userMetadata) {
  // The mock's /token only needs a poke to prove reachability; the Unicode
  // bearer is minted locally (small — a display name is tens of bytes).
  const res = await fetch(`${supabaseUrl}/auth/v1/health`);
  if (!res.ok) return null;
  // Re-mint the bearer with the Unicode claims: small enough for every
  // budget (a display name is tens of bytes), like a real provider name.
  const token = fakeJwt(userId, { email: "liming@example.com", user_metadata: userMetadata });
  const host = new URL(supabaseUrl).hostname.split(".")[0];
  const session = {
    access_token: token,
    refresh_token: `mock-refresh-${userId}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId },
  };
  return {
    name: `sb-${host}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  };
}

/** Expired access + marked oversized refresh: forces rotation on the cafe request. */
async function mintOversizedStaleSession(supabaseUrl, userId) {
  const expired = fakeJwt(userId, { email: "liming@example.com" }, -3600);
  const host = new URL(supabaseUrl).hostname.split(".")[0];
  const session = {
    access_token: expired,
    refresh_token: `mock-refresh-oversized-${userId}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1,
    user: { id: userId },
  };
  return {
    name: `sb-${host}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  };
}

async function checkRenderedCafeSession({
  base,
  cafeId,
  cafeName,
  sessionCookie,
  supabaseUrl,
  createContext,
  attachErrorCollector,
  stepLabel,
  shotName,
  oversized = false,
}) {
  await withGateContext(
    "verified-user-handoff",
    createContext,
    {},
    async (context, consoleLines) => {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, stepLabel, { path: `/cafes/${cafeId}`, status: 200 }, consoleLines);
      const res = await page.goto(`${base}/cafes/${cafeId}`, { waitUntil: "domcontentloaded" });
      assert(res?.status() === 200, `Expected 200 for seeded cafe, got ${res?.status()}`);
      if (oversized) {
        // The cafe navigation itself performed the rotation (no probe ran
        // before it): the refreshed cookies landed in the browser store…
        const cookies = await context.cookies();
        const authCookie = cookies.find((c) => c.name === sessionCookie.name);
        assert(authCookie, `${stepLabel}: rotation cookie missing after cafe navigation`);
        const planted = JSON.parse(
          Buffer.from(sessionCookie.value.replace(/^base64-/, ""), "base64url").toString("utf8"),
        );
        const session = JSON.parse(Buffer.from(authCookie.value.replace(/^base64-/, ""), "base64url").toString("utf8"));
        assert(
          typeof session.access_token === "string" && session.access_token !== planted.access_token,
          `${stepLabel}: access token was not rotated by the cafe navigation`,
        );
        // …and the oversized metadata was actually served on /user for the
        // rotated bearer (the false-pass guard: an unstaged user would get
        // no user_metadata here, and the page would render from a small
        // identity instead of the over-budget skip path).
        const userRes = await context.request.get(`${supabaseUrl}/auth/v1/user`, {
          headers: { authorization: `Bearer ${session.access_token}`, apikey: "e2e-anon-key" },
        });
        assert(userRes.ok(), `${stepLabel}: /user probe failed with ${userRes.status()}`);
        const userBody = await userRes.json();
        assert(
          typeof userBody?.user_metadata?.avatar_url === "string" &&
            userBody.user_metadata.avatar_url.length >= 2000,
          `${stepLabel}: oversized metadata was not served for the rotated bearer`,
        );
      }

      // Rendered cafe content: the cafe name heading is visible …
      await page.getByRole("heading", { name: cafeName }).first().waitFor({ state: "visible", timeout: 20000 });
      // … and the session landed authenticated: the map affordance shows
      // the account initial, not the sign-in glyph.
      const profileBadge = page.locator('a[href="/profile"] span').first();
      await profileBadge.waitFor({ state: "visible", timeout: 15000 });
      const initial = (await profileBadge.textContent())?.trim() ?? "";
      assert(initial.length > 0, "signed-in account initial missing on rendered cafe page");

      // The SSR shell hands off to the hydrated app in place.
      await page.locator("aside").first().waitFor({ state: "visible", timeout: 20000 });
      await shot(page, "verified-user-handoff", shotName);
      checkErrors();
      return page;
    },
    stepLabel,
  );
}

/**
 * @param {object} options
 * @param {string} options.label    log/error label for the trace.
 * @param {string} options.base     served origin of the standalone build.
 * @param {string} options.cafeId   DB-seeded cafe id.
 * @param {string} options.cafeName seeded cafe's display name.
 * @param {string} options.userId   DB-seeded profile id the session maps to.
 * @param {Function} options.createContext        smoke-suite context factory.
 * @param {Function} options.attachErrorCollector smoke-suite console/pageerror collector.
 */
export async function runVerifiedUserHandoffGate({
  label,
  base,
  cafeId,
  cafeName,
  userId,
  createContext,
  attachErrorCollector,
}) {
  clearGateArtifacts("verified-user-handoff");
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";

  // Sanity: the shared mint path still works (guards the helpers below).
  const sanity = await mintSession(supabaseUrl, userId);
  assert(sanity, `${label}: supabase-mock unreachable at ${supabaseUrl}`);

  for (const [name, shotName] of [["李明", "chinese"], ["☕ Nomad", "emoji"]]) {
    const cookie = await mintUnicodeSession(supabaseUrl, userId, { full_name: name });
    assert(cookie, `${label}: unicode session mint failed for ${name}`);
    await checkRenderedCafeSession({
      base,
      cafeId,
      cafeName,
      sessionCookie: cookie,
      supabaseUrl,
      createContext,
      attachErrorCollector,
      stepLabel: `${label} ${name}`,
      shotName,
    });
  }

  // Oversized + refresh on ONE request: expired bearer forces rotation, the
  // staged server-held CJK metadata busts the header budget, the proxy
  // skips the stamp but rotates cookies, and the page recovers signed-in.
  const stale = await mintOversizedStaleSession(supabaseUrl, userId);
  assert(stale, `${label}: oversized stale session mint failed`);
  await checkRenderedCafeSession({
    base,
    cafeId,
    cafeName,
    sessionCookie: stale,
    supabaseUrl,
    createContext,
    attachErrorCollector,
    stepLabel: `${label} oversized-refresh`,
    shotName: "oversized-refresh",
    oversized: true,
  });
}
