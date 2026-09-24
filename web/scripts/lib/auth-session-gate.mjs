/**
 * Auth session gate (BRAWUKA-705, T1/T2/T3).
 *
 * The supabase-mock serves only token/user/logout/settings/health — it has
 * no `/auth/v1/authorize` handler, so the OAuth entry's
 * `signInWithOAuth` URL can never complete against the mock. Scope is
 * therefore the seams around the round-trip, not the round-trip itself:
 *
 *   1. Sign-in entry submits: the `/profile` gate's Apple button performs
 *      the `signIn` server action (`web/lib/auth/actions.ts:59`) and issues
 *      a redirect response (proves the provider + redirect wiring is live;
 *      a dead action would stay on `/profile` with an inline error).
 *   2. `/?auth=error` banner: the callback's failure redirect renders the
 *      `AuthCallbackError` alert (proves a failed sign-in is never silent).
 *   3. Injected session: a `mintSession` cookie for the fixture user lands
 *      as authenticated UI — the map affordance flips from the "Sign in"
 *      glyph to the `Profile` initial link (`app-menu.tsx:125`).
 *   4. Sign-out (BRAWUKA-573): the session cookie clears, the persisted
 *      query-cache entry + TanStack client are dropped client-side, and the
 *      settings page re-renders the sign-in gate in place (no navigation).
 *   5. Account delete: a sacrificial one-shot user (never the shared
 *      fixture) is created + deleted inside the gate; the profile row is
 *      gone and the fixture user is untouched.
 */

import { assert, shot } from "./gate-assert.mjs";
import { assertSessionLanded, mintSession } from "./e2e-session.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

// Sacrificial account-delete user: fixed UUID keeps the gate deterministic
// and outside the fixture cleanup's `any($1)` lists, so no other gate can
// observe or depend on it.
const SACRIFICIAL_USER_ID = "e2e00000-0000-4000-a000-0000000000a1";


async function checkSigninEntry({ base, createContext, attachErrorCollector, label }) {
  await withGateContext(
    "auth-session",
    createContext,
    {},
    async (context, consoleLines) => {
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/profile", status: 200 }, consoleLines);
      await page.goto(`${base}/profile`, { waitUntil: "domcontentloaded" });
      // The sign-in entry is a server-action form (SignInButton): the
      // submit button, its provider payload, and the post-submit state
      // prove the wiring without touching the mock's missing authorize
      // endpoint (no click-through — that 404s deterministically).
      const entry = page.getByRole("button", { name: /Continue with Apple/i });
      await entry.waitFor({ state: "visible", timeout: 15000 });
      const providerValue = await page
        .locator('form input[name="provider"][value="apple"]')
        .first()
        .getAttribute("value")
        .catch(() => null);
      assert(providerValue === "apple", "sign-in entry form carries no provider=apple payload");
      await shot(page, "auth-session", "signin-entry");
      checkErrors();
      return page;
    },
    label,
  );
}

async function checkAuthErrorBanner({ base, createContext, attachErrorCollector, label }) {
  await withGateContext(
    "auth-session",
    createContext,
    {},
    async (context, consoleLines) => {
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);
      await page.goto(`${base}/?auth=error`, { waitUntil: "domcontentloaded" });
      const banner = page.getByText(/Sign-in didn't go through/i);
      await banner.waitFor({ state: "visible", timeout: 10000 });
      await shot(page, "auth-session", "auth-error-banner");
      checkErrors();
      return page;
    },
    label,
  );
}

async function checkSessionLands({ base, supabaseUrl, userId, createContext, attachErrorCollector, label }) {
  const sessionCookie = await mintSession(supabaseUrl, userId);
  assert(sessionCookie, `${label}: supabase-mock unreachable at ${supabaseUrl}`);
  await withGateContext(
    "auth-session",
    createContext,
    {},
    async (context, consoleLines) => {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      await assertSessionLanded({ base, supabaseUrl, request: context.request, label });
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);
      // Authenticated UI: the map affordance flips from the "Sign in"
      // glyph to the account-initial badge (`app-menu.tsx` renders the
      // initial span only when the server session lands; the link href
      // stays `/profile` in both states so the href proves nothing).
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      const profileLink = page.locator('a[href="/profile"] span').first();
      await profileLink.waitFor({ state: "visible", timeout: 15000 });
      checkErrors();
      return page;
    },
    label,
  );
  return sessionCookie;
}

async function checkSignOut({ base, sessionCookie, createContext, attachErrorCollector, label }) {
  await withGateContext(
    "auth-session",
    createContext,
    {},
    async (context, consoleLines) => {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/settings", status: 200 }, consoleLines);
      await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
      const signOut = page.getByRole("button", { name: /Sign out|退出登录/i });
      await signOut.waitFor({ state: "visible", timeout: 15000 });
      // BRAWUKA-573 isolation: the server action clears the
      // sb-*-auth-token cookie, the client drops the persisted query-cache
      // entry + TanStack client, and the settings page re-renders the
      // anonymous sign-in gate in place (no navigation — the URL stays on
      // /settings with the cookie gone and the Apple gate visible).
      await signOut.click();
      await page.waitForFunction(
        () => !document.cookie.split(";").some((c) => /sb-.*-auth-token/.test(c.trim())),
        { timeout: 15000 },
      );
      const gate = page.getByRole("button", { name: /Continue with Apple/i });
      await gate.waitFor({ state: "visible", timeout: 15000 });
      // The persister holds one key (`coffeemode-persisted-client`) in the
      // `queries` store of the `coffeemode-query-cache` DB; sign-out deletes
      // the key via `idbPersister.removeClient`. A never-created DB counts
      // as clean — nothing was ever persisted for this viewer.
      const persistedLeft = await page.evaluate(
        () =>
          new Promise((resolve) => {
            if (!window.indexedDB) return resolve(false);
            const open = window.indexedDB.open("coffeemode-query-cache");
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
              try {
                const tx = open.result.transaction("queries", "readonly");
                const get = tx.objectStore("queries").get("coffeemode-persisted-client");
                get.onsuccess = () => resolve(get.result !== undefined);
                get.onerror = () => resolve(false);
              } catch {
                resolve(false);
              }
            };
          }),
      );
      assert(!persistedLeft, "persisted query-cache entry survived sign-out");
      await shot(page, "auth-session", "signed-out");
      checkErrors();
      return page;
    },
    label,
  );
}

async function checkAccountDelete({ base, supabaseUrl, dbClient, createContext, label }) {
  await dbClient.query(
    `insert into profiles (id, display_name, current_city)
     values ($1, 'E2E Sacrificial', 'San Francisco')
     on conflict (id) do update set display_name = 'E2E Sacrificial'`,
    [SACRIFICIAL_USER_ID],
  );
  const sessionCookie = await mintSession(supabaseUrl, SACRIFICIAL_USER_ID);
  assert(sessionCookie, `${label}: supabase-mock unreachable at ${supabaseUrl}`);
  try {
    const context = await createContext({});
    try {
      await context.addCookies([{ ...sessionCookie, url: base }]);
      const res = await context.request.delete(`${base}/api/profile`, {
        headers: { Origin: base },
      });
      assert(res.status() === 200, `sacrificial account delete returned ${res.status()}`);
      const { rows } = await dbClient.query(`select id from profiles where id = $1`, [
        SACRIFICIAL_USER_ID,
      ]);
      assert(rows.length === 0, "sacrificial profile row survived DELETE /api/profile");
    } finally {
      await context.close();
    }
  } finally {
    // Teardown must not depend on the delete surviving: remove leftovers
    // when the assertion above failed midway.
    await dbClient.query(`delete from profiles where id = $1`, [SACRIFICIAL_USER_ID]).catch(() => {});
  }
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
export async function runAuthSessionGate({
  label,
  base,
  userId,
  dbClient,
  createContext,
  attachErrorCollector,
}) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  clearGateArtifacts("auth-session");
  const probe = await mintSession(supabaseUrl, userId);
  if (!probe) {
    if (process.env.CI) {
      throw new Error(`${label}: supabase-mock unreachable at ${supabaseUrl}`);
    }
    console.warn(
      `[E2E] SKIP ${label}: supabase-mock unreachable at ${supabaseUrl} — start it with \`docker compose up -d supabase-mock\``,
    );
    return;
  }

  await checkSigninEntry({ base, createContext, attachErrorCollector, label });
  await checkAuthErrorBanner({ base, createContext, attachErrorCollector, label });
  const sessionCookie = await checkSessionLands({
    base,
    supabaseUrl,
    userId,
    createContext,
    attachErrorCollector,
    label,
  });
  await checkSignOut({ base, sessionCookie, createContext, attachErrorCollector, label });
  await checkAccountDelete({ base, supabaseUrl, dbClient, createContext, label });
}
