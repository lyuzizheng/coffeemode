/**
 * Locale switch gate (BRAWUKA-835, parent BRAWUKA-821).
 *
 * Covers T7's locale half: the `locale` cookie is an SSR input on `/cafes/[id]`,
 * so zh→en→zh on the SAME URL must re-render visible cafe copy — not merely
 * flip `html lang` or serialize a message catalog into the document (the
 * layout streams the whole catalog to the client Providers, so a raw-body or
 * `innerHTML` grep for zh strings passes even when every visible control is
 * English).
 *
 * What this gate proves on the seeded cafe URL:
 *   - `html lang` follows the cookie in both directions (en → zh → en).
 *   - After the DG124 overlay unmounts and the app surface is live, a
 *     role+name+visible assertion finds the locale's check-in CTA
 *     ("Check in"/"打卡") and zero of the other locale's. Waiting for overlay
 *     removal FIRST is load-bearing: the SSR overlay renders the same CTA, so
 *     a check that finishes before hydration proves nothing about hydrated
 *     copy — and a hydration-level locale miss keeps the wrong copy visible
 *     (P1 review finding: the pre-fix gate passed on the overlay 85ms after
 *     navigation while the app showed "Check in" under lang="zh").
 *   - The SSR document itself carries the locale's copy once script-embedded
 *     payloads are stripped — SSR coverage, independent of hydration.
 *   - Both wrong-copy shapes are detected by the same assertion path:
 *     every-depth tamper (SSR + flight catalog wrong) and script-only tamper
 *     (SSR markup correct, hydrated copy wrong). Neither may be satisfied by
 *     `lang` + catalog bytes or `lang` + SSR bytes.
 *
 * The context pins `locale: "en-US"` (Accept-Language: en) so a zh render can
 * only come from the cookie, never from negotiation.
 */
import { assert } from "./gate-assert.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

const SLUG = "locale-switch";
const CAFE_PATH = (cafeId) => `/cafes/${cafeId}`;
/** Hydration + shell-fade headroom for visible-copy waits. */
const VISIBLE_TIMEOUT_MS = 15000;
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/gi;

/** SSR document text minus script payloads — the strip makes the assertion
 * blind to the serialized next-intl catalog and RSC flight data. */
function documentCopy(html) {
  return html.replace(SCRIPT_BLOCK, "");
}

async function setLocaleCookie(context, base, value) {
  await context.addCookies([{ name: "locale", value, url: base }]);
}

/**
 * App-live wait shared by every navigation and fault demo. The DG124 SSR
 * overlay keeps its own check-in CTA in the a11y tree until mount+fade, so a
 * copy assertion taken earlier can pass on the overlay and never measure
 * hydrated copy. The overlay's masthead `header` detaches when it unmounts;
 * the app's discovery `aside` then proves the live surface is up.
 */
async function waitForAppLive(page) {
  await page.waitForSelector("header", { state: "detached", timeout: 20000 });
  await page.locator("aside").first().waitFor({ state: "visible", timeout: 20000 });
}

/**
 * The gate's visible-copy oracle — the ONLY assertion shape the gate claims:
 * after the app is live, the locale's check-in CTA is a visible button and
 * the other locale's is absent. Positive checks call it directly; fault demos
 * call it expecting the throw. Exact accessible names, not substring greps.
 */
async function assertVisibleCopy(page, copy, foreignCopy) {
  await waitForAppLive(page);
  await page.getByRole("button", { name: copy, exact: true }).first().waitFor({ state: "visible", timeout: VISIBLE_TIMEOUT_MS });
  assert(
    (await page.getByRole("button", { name: foreignCopy, exact: true }).count()) === 0,
    `Foreign-locale "${foreignCopy}" control rendered alongside "${copy}"`,
  );
}

/**
 * One locale render of the cafe URL: status, `html lang`, hydrated visible
 * CTA from this locale only, and script-stripped SSR copy.
 */
async function assertLocaleRender({ context, page, base, cafeId, cookie, lang, copy, foreignCopy }) {
  await setLocaleCookie(context, base, cookie);
  const res = await page.goto(`${base}${CAFE_PATH(cafeId)}`, { waitUntil: "domcontentloaded" });
  assert(res?.status() === 200, `Expected 200 for seeded cafe (${lang}), got ${res?.status()}`);
  assert(
    (await page.locator("html").getAttribute("lang")) === lang,
    `Expected html lang="${lang}" with locale=${cookie} cookie`,
  );
  await assertVisibleCopy(page, copy, foreignCopy);
  assert(
    documentCopy(await res.text()).includes(copy),
    `SSR document (${lang}) lacks "${copy}" outside script payloads`,
  );
}

/**
 * Fetch the cafe document through a route that rewrites zh copy to "Check in".
 * scope "all" hits every depth (markup + flight catalog — a wrong-locale
 * CDN shell); scope "scripts" hits script bodies only (correct SSR, wrong
 * hydrated copy — a provider/catalog-level fault).
 */
async function installCopyTamper(context, cafeId, scope) {
  let hits = 0;
  // Glob must lead with `**` — Playwright matches the full URL, so a bare
  // path pattern silently misses and the demo would judge the REAL page.
  await context.route(`**${CAFE_PATH(cafeId)}**`, async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    if (scope === "scripts") {
      html = html.replace(SCRIPT_BLOCK, (block) => block.replaceAll("打卡", "Check in"));
    } else {
      // Deepest escape first, or an un-escape pass would produce fresh 打卡
      // the literal pass never sees: `\\\\u…` → literal, `\\u…` → en, 打卡 → en.
      html = html
        .replaceAll("\\\\u6253\\\\u5361", "打卡")
        .replaceAll("\\u6253\\u5361", "Check in")
        .replaceAll("打卡", "Check in");
    }
    hits += 1;
    await route.fulfill({ response: res, body: html });
  });
  return () => hits;
}

/**
 * Navigate the tampered document and prove the gate's own assertion rejects
 * it: `assertVisibleCopy(page, "打卡", "Check in")` must throw.
 */
async function assertTamperRejected({ context, page, base, cafeId, scope, expectSsrCopy }) {
  await setLocaleCookie(context, base, "zh");
  const hits = await installCopyTamper(context, cafeId, scope);
  const res = await page.goto(`${base}${CAFE_PATH(cafeId)}`, { waitUntil: "domcontentloaded" });
  assert(res?.status() === 200, `Fault demo navigation failed: ${res?.status()}`);
  assert(hits() > 0, `Fault demo (${scope}) route never intercepted the navigation — pattern missed the URL`);
  assert(
    (await page.locator("html").getAttribute("lang")) === "zh",
    `Fault demo (${scope}) did not produce lang="zh"`,
  );
  const ssrHasZh = documentCopy(await res.text()).includes("打卡");
  assert(
    ssrHasZh === expectSsrCopy,
    `Fault demo (${scope}) SSR copy shape wrong: document ${ssrHasZh ? "has" : "lacks"} 打卡`,
  );
  let rejected = null;
  try {
    await assertVisibleCopy(page, "打卡", "Check in");
  } catch (err) {
    rejected = err;
  }
  assert(rejected !== null, `Wrong-copy fault (${scope}) passed the visible 打卡 assertion — gate is blind`);
}

/** Fault-demo page plumbing: console captured for artifacts, never asserted —
 * a tampered document's console is not the product's. */
async function runFaultStep({ createContext, label, fn }) {
  await withGateContext(
    SLUG,
    createContext,
    { locale: "en-US" },
    async (context, consoleLines) => {
      const page = await context.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleLines.push(`fault-demo console.error: ${msg.text()}`);
      });
      page.on("pageerror", (err) => consoleLines.push(`fault-demo pageerror: ${err.message}`));
      await fn(context, page);
      return page;
    },
    label,
  );
}

/**
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.base
 * @param {string} options.cafeId
 * @param {Function} options.createContext
 * @param {Function} options.attachErrorCollector
 */
export async function runLocaleSwitchGate({ label, base, cafeId, createContext, attachErrorCollector }) {
  clearGateArtifacts(SLUG);

  // Step 1 — the contract: cookie → same URL → SSR re-render, both locales,
  // proven on hydrated visible controls. Accept-Language pinned to en;
  // without the cookie this context always negotiates English (i18n/request.ts).
  await withGateContext(
    SLUG,
    createContext,
    { locale: "en-US" },
    async (context, consoleLines) => {
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: CAFE_PATH(cafeId), status: 200 }, consoleLines);
      try {
        await assertLocaleRender({ context, page, base, cafeId, cookie: "en", lang: "en", copy: "Check in", foreignCopy: "打卡" });
        await assertLocaleRender({ context, page, base, cafeId, cookie: "zh", lang: "zh", copy: "打卡", foreignCopy: "Check in" });
        await assertLocaleRender({ context, page, base, cafeId, cookie: "en", lang: "en", copy: "Check in", foreignCopy: "打卡" });
      } finally {
        checkErrors();
      }
      return page;
    },
    label,
  );

  // Step 2 — wrong-locale shell: zh lang, SSR AND catalog rewritten (the
  // CDN-vary miss). SSR check confirms the tamper shaped the document.
  await runFaultStep({
    createContext,
    label,
    fn: (context, page) => assertTamperRejected({ context, page, base, cafeId, scope: "all", expectSsrCopy: false }),
  });

  // Step 3 — hydrated-only fault: SSR markup stays correct, the flight
  // catalog is rewritten (provider delivers wrong-locale copy). The same
  // visible assertion must reject it — this is the shape that passed the
  // pre-review gate via the SSR overlay.
  await runFaultStep({
    createContext,
    label,
    fn: (context, page) => assertTamperRejected({ context, page, base, cafeId, scope: "scripts", expectSsrCopy: true }),
  });
}
