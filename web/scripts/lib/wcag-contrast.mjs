/**
 * WCAG 2.x contrast math — the single source of truth shared by the two gates
 * that defend spec 0002's AA invariant (body text >= 4.5:1, large text >= 3:1):
 *
 *   - `tests/design-tokens-contrast.test.ts` — token pairs parsed from
 *     `app/globals.css` (dark + light), the deterministic CI gate.
 *   - `scripts/visual-smoke.mjs` — the painted-byte audit of the rendered route
 *     matrix, which catches page-level token misuse a token-pair check cannot
 *     see (e.g. small sage text on a dark surface).
 *
 * The OKLab -> linear sRGB matrices are Björn Ottosson's; the sRGB transfer
 * function is applied ONCE (never re-linearise an already-linear channel), per
 * spec 0002's "Dark theme brand pairs" note.
 */

const SRGB_TO_LINEAR = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * OKLCH (L 0..1, C, hue degrees) -> 8-bit sRGB, matching what a browser paints
 * for an in-gamut token. Out-of-gamut values clip per channel like a plain
 * canvas rasterisation; the lint of token values keeps our tokens in gamut.
 */
export function oklchToRgb(lightness, chroma, hueDeg) {
  const hue = (hueDeg * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  });
}

/**
 * Parse a CSS `oklch()` literal into its components. Accepts percentage or
 * 0..1 lightness, and rejects anything else so a token rewrite cannot silently
 * drop a pair out of the gate.
 */
export function parseOklch(value) {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value.trim());
  if (!match) throw new Error(`not an oklch() value: ${value}`);
  const [, rawL, unit, rawC, rawH] = match;
  const lightness = Number(rawL) / (unit === "%" ? 100 : 1);
  return { lightness, chroma: Number(rawC), hue: Number(rawH) };
}

/** WCAG relative luminance of an 8-bit sRGB triple. */
export function relativeLuminance([r, g, b]) {
  return (
    0.2126 * SRGB_TO_LINEAR(r) + 0.7152 * SRGB_TO_LINEAR(g) + 0.0722 * SRGB_TO_LINEAR(b)
  );
}

/** WCAG contrast ratio between two 8-bit sRGB triples (order-independent). */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast ratio of a token pair written as CSS `oklch()` literals. */
export function oklchPairRatio(foreground, background) {
  const fg = parseOklch(foreground);
  const bg = parseOklch(background);
  return contrastRatio(
    oklchToRgb(fg.lightness, fg.chroma, fg.hue),
    oklchToRgb(bg.lightness, bg.chroma, bg.hue),
  );
}

/**
 * Flatten a translucent foreground over an opaque background — the painted
 * colour a reader actually sees (source-over, non-premultiplied bytes).
 */
export function compositeColor([r, g, b, alpha], [br, bg, bb]) {
  const a = Math.min(1, Math.max(0, alpha));
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)].map((c) =>
    Math.round(c),
  );
}

/** Spec 0002: body text >= 4.5:1, large text (>= 24px, or >= 18.66px bold) >= 3:1. */
export function minimumRatio(fontSizePx, fontWeight) {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
}

/**
 * Verdict for one rendered text sample: the ratio plus the threshold it must
 * clear. `ratio` is rounded to two decimals for stable reporting.
 */
export function verdictFor(sample) {
  const ratio = contrastRatio(sample.foreground, sample.background);
  const required = minimumRatio(sample.fontSizePx, sample.fontWeight);
  return { ratio: Math.round(ratio * 100) / 100, required, passes: ratio >= required };
}
