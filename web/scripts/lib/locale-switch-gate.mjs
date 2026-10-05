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
 *   - A role+name+visible assertion finds exactly one locale's check-in CTA
 *     per render ("Check in" / "打卡"); the other locale's CTA is absent
 *     (`count() === 0`), with a wait budget that outlives hydration and the
 *     DG124 shell fade (the overlay goes `inert` on mount, so its a11y tree
 *     stops matching `getByRole`; `.first()` covers the SSR-paint window
 *     where shell and app render duplicate CTAs).
 *   - The SSR document itself carries the locale's copy once script-embedded
 *     payloads are stripped — SSR coverage, independent of client hydration.
 *   - A tampered response (en shell body under `lang="zh"`, the wrong-locale
 *     CDN hit) makes the visible-CTA assertion fail — the gate cannot be
 *     satisfied by `lang` + catalog bytes alone.
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

/** SSR document text minus script payloads — the strip makes the assertion
 * blind to the serialized next-intl catalog and RSC flight data. */
function documentCopy(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

async function setLocaleCookie(context, base, value) {
  await context.addCookies([{ name: "locale", value, url: base }]);
}

/** The locale's visible check-in CTA: button role + exact accessible name +
 * `visible` state (not innerHTML/body-text greps). */
function checkInButton(page, copy) {
  return page.getByRole("button", { name: copy, exact: true }).first();
}

/**
 * One locale render of the cafe URL: status, `html lang`, visible CTA from
 * this locale only, and script-stripped SSR copy. Asserts the fault the
 * previous body-grep missed: correct `lang` with wrong visible copy.
 */
async function assertLocaleRender({ context, page, base, cafeId, cookie, lang, copy, foreignCopy }) {
  await setLocaleCookie(context, base, cookie);
  const res = await page.goto(`${base}${CAFE_PATH(cafeId)}`, { waitUntil: "domcontentloaded" });
  assert(res?.status() === 200, `Expected 200 for seeded cafe (${lang}), got ${res?.status()}`);
  assert(
    (await page.locator("html").getAttribute("lang")) === lang,
    `Expected html lang="${lang}" with locale=${cookie} cookie`,
  );
  await checkInButton(page, copy).waitFor({ state: "visible", timeout: VISIBLE_TIMEOUT_MS });
  assert(
    (await page.getByRole("button", { name: foreignCopy, exact: true }).count()) === 0,
    `Foreign-locale "${foreignCopy}" control rendered on ${lang} shell`,
  );
  assert(
    documentCopy(await res.text()).includes(copy),
    `SSR document (${lang}) lacks "${copy}" outside script payloads`,
  );
}

/**
 * Wrong-locale shell under the right `lang`: fulfills the navigation with the
 * zh document but every 打卡 occurrence rewritten to "Check in" — the
 * CDN-vary miss shape. The gate's own visible assertion MUST fail here;
 * anything else is a blind gate.
 */
async function assertWrongCopyDetected({ context, page, base, cafeId }) {
  await setLocaleCookie(context, base, "zh");
  // Glob must lead with `**` — Playwright matches the full URL, so a bare
  // path pattern silently misses and the demo would judge the REAL page.
  // `hits` proves the tamper actually ran.
  let hits = 0;
  await context.route(`**${CAFE_PATH(cafeId)}**`, async (route) => {
    const res = await route.fetch();
    const html = (await res.text())
      // Every escape depth → en, deepest first: `\\\\u…` (JSON inside a JS
      // literal) → literal, `\\u…` → en, then literal 打卡 → en. Reversing
      // the order would un-escape fresh 打卡 back into the document.
      .replaceAll("\\\\u6253\\\\u5361", "打卡")
      .replaceAll("\\u6253\\u5361", "Check in")
      .replaceAll("打卡", "Check in");
    hits += 1;
    await route.fulfill({ response: res, body: html });
  });
  const res = await page.goto(`${base}${CAFE_PATH(cafeId)}`, { waitUntil: "domcontentloaded" });
  assert(res?.status() === 200, `Fault demo navigation failed: ${res?.status()}`);
  assert(hits > 0, "Fault demo route never intercepted the cafe navigation — pattern missed the URL");
  assert(
    (await page.locator("html").getAttribute("lang")) === "zh",
    `Fault demo did not produce lang="zh", got "${await page.locator("html").getAttribute("lang")}"`,
  );
  let rejected = null;
  try {
    await checkInButton(page, "打卡").waitFor({ state: "visible", timeout: VISIBLE_TIMEOUT_MS });
  } catch (err) {
    rejected = err;
  }
  assert(
    rejected !== null,
    "Wrong-copy fault (zh lang, en CTA) passed the visible 打卡 assertion — gate is blind",
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
  // proven on visible controls. Accept-Language pinned to en; without the
  // cookie this context always negotiates English (i18n/request.ts).
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

  // Step 2 — the detector: same URL, zh cookie, wrong-locale shell. No
  // error collector: the tampered document's console is not the product's.
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
      await assertWrongCopyDetected({ context, page, base, cafeId });
      return page;
    },
    label,
  );
}
