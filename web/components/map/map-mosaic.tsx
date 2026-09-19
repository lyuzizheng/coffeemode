"use client";

/**
 * Mosaic map reveal (BRAWUKA-506 §3): the basemap's loading mask is a
 * coarse pixel grid in the surface palette. While the maplibre chunk and
 * first style load are in flight the cells sit opaque; once the basemap
 * reports ready (`revealed`), each cell fades out in a deterministic
 * shuffled order — the map "resolves" out of mosaic blocks instead of
 * hard-cutting from a skeleton.
 *
 * Constraints honored:
 *   - ≤450ms total (spec 0002 settle.slow ceiling): last cell starts at
 *     59×5ms = 295ms and fades for 140ms → 435ms.
 *   - prefers-reduced-motion: the global kill switch in globals.css
 *     collapses the transition to ~0ms, so the mask simply disappears.
 *   - Pure CSS transitions on opacity — no WebGL, no timers, no main-thread
 *     work beyond one class flip.
 *   - Deterministic order (mulberry32, fixed seed): the reveal pattern is
 *     stable across SSR/remounts and test runs — no hydration mismatch.
 */

/** Grid geometry: 10×6 cells read as chunky pixels on both the mobile
 * full-viewport map and the desktop flex surface. */
const COLS = 10;
const ROWS = 6;
const CELL_COUNT = COLS * ROWS;
/** Per-cell stagger step and fade length — see the ≤450ms budget above. */
const STEP_MS = 5;
const FADE_MS = 140;

/** Deterministic PRNG (mulberry32) — the reveal order is a fixed shuffle,
 * not Math.random, so every mount resolves identically. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Surface-palette cells: a tonal checker of the paper steps so the mask
 * reads as a pixelated map surface, not a flat gray. */
const CELL_TONES = [
  "bg-surface-secondary",
  "bg-surface-tertiary",
  "bg-surface-secondary",
  "bg-surface",
] as const;

const CELLS: { tone: (typeof CELL_TONES)[number]; delayMs: number }[] = (() => {
  const order = Array.from({ length: CELL_COUNT }, (_, i) => i);
  const rand = mulberry32(0xcafe);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const delayByCell = new Array<number>(CELL_COUNT);
  order.forEach((cell, rank) => {
    delayByCell[cell] = rank * STEP_MS;
  });
  return delayByCell.map((delayMs, i) => ({
    tone: CELL_TONES[(i * 7 + Math.floor(i / COLS) * 3) % CELL_TONES.length],
    delayMs,
  }));
})();

export function MapMosaic({ revealed }: { revealed: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 grid"
      style={{
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      }}
    >
      {CELLS.map((cell, i) => (
        <div
          key={i}
          className={`${cell.tone} transition-opacity`}
          style={{
            opacity: revealed ? 0 : 1,
            transitionDuration: `${FADE_MS}ms`,
            transitionDelay: revealed ? `${cell.delayMs}ms` : "0ms",
          }}
        />
      ))}
    </div>
  );
}
