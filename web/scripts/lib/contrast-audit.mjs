/**
 * Rendered-page contrast audit — the browser half of spec 0002's AA gate.
 *
 * `collectTextSamples` runs inside the page (Playwright serialises it, so it
 * must stay self-contained): it walks every visible text node, resolves the
 * effective background behind it, and returns the painted foreground/background
 * byte pairs. `auditPageContrast` scores them with the shared WCAG math, so the
 * audit and the token gate cannot drift apart.
 *
 * Byte-level measurement is deliberate: the browser's own painted bytes are
 * what a reader sees, including opacity, alpha layers, `color-mix()` results
 * and colour-space conversions a static token read cannot model.
 *
 * Inactive controls are exempt from WCAG 1.4.3, and `aria-hidden` is the
 * codebase's own declaration of decoration (the spec 0004 §5 score watermark);
 * those subtrees are counted separately instead of being silently dropped.
 */
import { verdictFor } from "./wcag-contrast.mjs";

/** In-page: walk visible text nodes and return painted fg/bg byte pairs. */
export function collectTextSamples() {
  // Playwright serialises this function into the page: module scope is not
  // available there, so every value it needs is declared inside it.
  const inert = "script,style,noscript,template,[hidden],[disabled],[aria-disabled='true'],[data-disabled='true']";
  const decorative = "[aria-hidden='true']";
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  function bytes(css) {
    if (!cache.has(css)) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      cache.set(css, [d[0], d[1], d[2], d[3] / 255]);
    }
    return cache.get(css);
  }
  function over([r, g, b, a], [br, bg, bb]) {
    return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)].map(Math.round);
  }
  function describe(el) {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      parts.unshift(n.tagName.toLowerCase() + [...n.classList].slice(0, 2).map((c) => `.${c}`).join(""));
    }
    return parts.join(" > ");
  }
  function backdrop(el) {
    const layers = [];
    let node = el, alpha = 1, unsupported = false;
    while (node) {
      const cs = getComputedStyle(node);
      const bg = bytes(cs.backgroundColor);
      const opacity = Number(cs.opacity || 1);
      if (cs.backgroundImage !== "none") unsupported = true;
      if (bg[3] >= 1) {
        if (opacity < 1) unsupported = true;
        layers.push(bg);
        break;
      }
      if (bg[3] > 0) layers.push(bg);
      alpha *= opacity;
      node = node.parentElement;
    }
    if (layers.length === 0 || layers[layers.length - 1][3] < 1) return { unsupported: true };
    let base = layers.pop().slice(0, 3);
    while (layers.length > 0) base = over(layers.pop(), base);
    return { base, alpha, unsupported };
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const samples = [];
  const visited = new Set();
  let decorativeCount = 0;
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    const text = walker.currentNode.textContent.trim();
    if (!el || !text || visited.has(el)) continue;
    visited.add(el);
    if (el.closest(decorative)) decorativeCount += 1;
    else if (!el.closest(inert)) {
      const cs = getComputedStyle(el);
      const hidden = cs.display === "none" || cs.visibility === "hidden" || el.getClientRects().length === 0;
      const bg = hidden ? { unsupported: true } : backdrop(el);
      if (!bg.unsupported) {
        const c = bytes(cs.color);
        samples.push({
          selector: describe(el),
          text: text.slice(0, 40),
          fontSizePx: Number.parseFloat(cs.fontSize) || 16,
          fontWeight: Number(cs.fontWeight) || 400,
          foreground: over([c[0], c[1], c[2], c[3] * bg.alpha], bg.base),
          background: bg.base,
        });
      }
    }
  }
  return { samples, decorativeCount };
}

/** Score the page's painted text; returns every sample under its AA threshold. */
export async function auditPageContrast(page) {
  const { samples, decorativeCount } = await page.evaluate(collectTextSamples);
  const offenders = [];
  for (const sample of samples) {
    const verdict = verdictFor(sample);
    if (!verdict.passes) offenders.push({ ...sample, ratio: verdict.ratio, required: verdict.required });
  }
  return { checked: samples.length, decorative: decorativeCount, offenders };
}

/** One line per offender for the gate's failure report. */
export function formatContrastOffenders(label, offenders) {
  const lines = offenders.map(
    (o) =>
      `contrast ${o.ratio}:1 < ${o.required}:1 — ${o.fontSizePx}px/${o.fontWeight} ` +
      `"${o.text}" ${o.selector} fg rgb(${o.foreground}) on rgb(${o.background})`,
  );
  return `${label}\n    ${lines.join("\n    ")}`;
}
