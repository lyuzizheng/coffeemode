import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oklchPairRatio, parseOklch } from "../scripts/lib/wcag-contrast.mjs";

/**
 * Spec 0002's AA gate, asserted against the token values themselves (BRAWUKA-219).
 *
 * This is the deterministic half of the gate: it runs in `npm test`, so a token
 * edit that drops a documented pair under 4.5:1 fails CI before any rendering.
 * The rendered half — `npm run check:visual`, which scores the browser's painted
 * bytes across the route matrix and catches page-level token misuse — cannot be
 * a CI job (spec 0003 keeps `check:visual` as local evidence).
 *
 * Ratios come from the shared `scripts/lib/wcag-contrast.mjs` math, so both
 * halves of the gate agree by construction.
 */
const AA_BODY_TEXT = 4.5;

/** 8-bit quantisation between the token math and a browser's painted bytes. */
const QUANTISATION = 0.05;

/** Spec 0002's recorded light-theme ratios: the "no regression" floor. */
const LIGHT_BASELINE = {
  "secondary/secondary-foreground": 6.57,
  "danger/danger-foreground": 6.27,
  "white/danger-solid": 6.54,
};

/** The documented pairs, per theme. Long-form descriptions live in spec 0002. */
const PAIRS = ["accent/accent-foreground", "secondary/secondary-foreground", "secondary-hover/secondary-foreground", "danger/danger-foreground", "white/danger-solid"];

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Slice one theme block: from its selector to the first closing brace. */
function themeBlock(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`theme block not found in app/globals.css: ${selector}`);
  const end = CSS.indexOf("\n}", start);
  return CSS.slice(start, end);
}

/** Read a token's literal value; a missing or non-oklch token fails the test. */
function token(block: string, name: string): string {
  const match = new RegExp(`\\n\\s*${name}\\s*:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`token ${name} not found — the AA gate cannot check it`);
  const value = match[1].trim();
  if (!value.startsWith("oklch(")) throw new Error(`token ${name} is not an oklch() literal: ${value}`);
  return value;
}

const LIGHT = themeBlock(':root,\n.light,\n[data-theme="light"]');
const DARK = themeBlock('.dark,\n[data-theme="dark"]');

/** `white` in a pair is the literal white a `text-white` label paints. */
const WHITE = "oklch(100% 0 0)";

function ratioOf(block: string, pair: string): number {
  const [foreground, background] = pair.split("/");
  const fg = foreground === "white" ? WHITE : token(block, `--${foreground}`);
  return oklchPairRatio(fg, token(block, `--${background}`));
}

describe("design token contrast (spec 0002 AA gate)", () => {
  it.each(PAIRS)("dark %s clears 4.5:1", (pair) => {
    expect(ratioOf(DARK, pair)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it.each(PAIRS)("light %s clears 4.5:1", (pair) => {
    expect(ratioOf(LIGHT, pair)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("light pairs do not regress below their recorded ratios", () => {
    for (const [pair, recorded] of Object.entries(LIGHT_BASELINE)) {
      expect(ratioOf(LIGHT, pair), `light ${pair} regressed`).toBeGreaterThanOrEqual(recorded - QUANTISATION);
    }
  });

  // The dark palette was retuned for contrast twice (BRAWUKA-130, BRAWUKA-219).
  // Hue and chroma are the brand: only lightness may move, so a future fix
  // cannot buy contrast by desaturating the sage or the danger clay.
  it("dark brand hue and chroma are held", () => {
    const sage = parseOklch(token(DARK, "--secondary"));
    const danger = parseOklch(token(DARK, "--danger"));
    const dangerSolid = parseOklch(token(DARK, "--danger-solid"));
    expect({ chroma: sage.chroma, hue: sage.hue }).toEqual({ chroma: 0.08, hue: 155 });
    expect({ chroma: danger.chroma, hue: danger.hue }).toEqual({ chroma: 0.19, hue: 27 });
    expect({ chroma: dangerSolid.chroma, hue: dangerSolid.hue }).toEqual({ chroma: 0.19, hue: 27 });
  });
});
