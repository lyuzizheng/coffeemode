/**
 * Shared gate helpers for the E2E suite (BRAWUKA-704).
 *
 * The 5-line `assert` clone lived in every gate file; a 6th copy trips
 * `sonarjs/no-identical-functions` (threshold 3 lines,
 * `structure.config.mjs:29`). Gates import from here instead of cloning.
 */
import { saveGateScreenshot } from "./e2e-artifacts.mjs";

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Placement flips at ≥1024px (BRAWUKA-516): bottom sheet on mobile,
// right-side panel on desktop — select the slot, not the modifier class
// (`section.drawer__dialog--bottom` only matches the bottom sheet).
export const DRAWER_DIALOG_SELECTOR = "[data-slot='drawer-dialog']";

/** Key-step screenshot into the gate's artifact directory (success path). */
export async function shot(page, slug, name) {
  await saveGateScreenshot(page, slug, name);
}
