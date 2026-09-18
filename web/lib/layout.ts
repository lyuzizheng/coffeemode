/**
 * Shared layout geometry (BRAWUKA-418): discovery columns, sheet detents,
 * thumbnails, content width, and map-chrome offsets.
 *
 * Single source of truth for every layout pixel value that more than one
 * component depends on. Two consumption channels, one number each:
 *
 *   - TS/JS: import the `*_PX` constants (camera padding, `sizes` hints,
 *     inline-style calc()).
 *   - CSS/Tailwind: `LAYOUT_CSS_VARS` is applied to `<html>` in
 *     app/layout.tsx, so `var(--layout-*)` works in arbitrary values
 *     (`w-[var(--layout-aside-column)]`), calc(), and globals.css.
 *
 * Never re-declare these numbers locally — a literal that drifts from the
 * constant is a bug (the 380/400 column split already happened once).
 */

/** Mobile sheet PEEK detent: visible height of the collapsed card strip
 * (cover row + padding; safe-area is padded inside the sheet). Everything
 * floating above the map anchors to this on small screens. */
export const SHEET_PEEK_PX = 172;
/** Mobile sheet collapsed detent (BRAWUKA-373): drag handle + the slim
 * "附近 N 家" bar — the pull-down detent below PEEK. */
export const SHEET_COLLAPSED_PX = 48;
/** Desktop discovery sidebar (feed/search) column width. */
export const ASIDE_COLUMN_PX = 380;
/** Desktop cafe-detail column width — overlays the map below xl, so the
 * camera padding and the detail overlay both key off this. */
export const DETAIL_COLUMN_PX = 400;
/** Square thumbnail edge for check-in/gallery photo strips and card covers
 * (feed-card, gallery-strip, checkin-photos, profile-tab-cafes, cafe-card). */
export const THUMB_PX = 72;
/** Max width of the single-column reading surface (cafe detail, profile). */
export const CONTENT_MAX_W_PX = 640;
/** Clearance that keeps floating chrome off other floating chrome: the
 * nav-prompt's right edge clears the locate button, and the account chip
 * drops below the mobile search capsule. */
export const MAP_CHROME_OFFSET_PX = 76;

/** `:root`-level custom properties mirroring the constants above — applied
 * to `<html>` in app/layout.tsx so Tailwind arbitrary values and plain CSS
 * (globals.css) resolve the same numbers. */
export const LAYOUT_CSS_VARS = {
  "--layout-sheet-peek": `${SHEET_PEEK_PX}px`,
  "--layout-sheet-collapsed": `${SHEET_COLLAPSED_PX}px`,
  "--layout-aside-column": `${ASIDE_COLUMN_PX}px`,
  "--layout-detail-column": `${DETAIL_COLUMN_PX}px`,
  "--layout-thumb": `${THUMB_PX}px`,
  "--layout-content-max": `${CONTENT_MAX_W_PX}px`,
  "--layout-chrome-offset": `${MAP_CHROME_OFFSET_PX}px`,
} as const;
