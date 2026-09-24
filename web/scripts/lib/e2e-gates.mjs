/**
 * E2E gate registry (BRAWUKA-704).
 *
 * `scripts/e2e-smoke.mjs` is frozen at the 400-line hard budget: new gates
 * register here, and the runner calls `runRegistryGates` once. Each entry
 * declares whether it runs under `E2E_VIEWPORT=mobile` (D4 allowlist:
 * `auth-session`, `checkin-submit`, `search-discovery` — the last two land in
 * later slices) and whether it needs the DB fixtures; the loop filters.
 * Gates receive the full runner context and pick the fields they need.
 */
import { runApiContractGate } from "./api-contract-gate.mjs";
import { runCheckinDrawerGate } from "./checkin-drawer-gate.mjs";
import { runCheckinSubmitGate } from "./checkin-submit-gate.mjs";
import { runDeeplinkHydrationGate } from "./deeplink-hydration-gate.mjs";
import { runSearchDiscoveryGate } from "./search-discovery-gate.mjs";
import { runFeedPaginationGate } from "./feed-pagination-gate.mjs";
import { runOwnerControlsGate } from "./owner-controls-gate.mjs";
import { runSwPrivacyGate } from "./sw-privacy-gate.mjs";
import { recordGateFailure } from "./e2e-artifacts.mjs";

export const E2E_GATES = [
  {
    slug: "deeplink-hydration",
    label: "T2b: Deep-Link Hydration (DG124)",
    mobile: false,
    needsDb: true,
    run: runDeeplinkHydrationGate,
  },
  {
    slug: "api-contract",
    label: "T6: Core API Contract Endpoints",
    mobile: false,
    needsDb: false,
    run: runApiContractGate,
  },
  {
    slug: "checkin-drawer",
    label: "T7: Check-in Drawer CTA Inside the Viewport",
    mobile: false,
    needsDb: true,
    run: runCheckinDrawerGate,
  },
  {
    slug: "checkin-submit",
    label: "T8: Check-in Submit Flow (Real Session via supabase-mock)",
    mobile: true,
    needsDb: true,
    run: runCheckinSubmitGate,
  },
  {
    slug: "search-discovery",
    label: "T16/T16b/T6/T17-UI: Search Discovery & Geolocation & Turnstile UI",
    mobile: true,
    needsDb: true,
    run: runSearchDiscoveryGate,
  },
  {
    slug: "feed-pagination",
    label: "T12: Check-in Feed Pagination & Mode Switch & Invalid Cursor Recovery",
    mobile: false,
    needsDb: true,
    run: runFeedPaginationGate,
  },
  {
    slug: "owner-controls",
    label: "T25: Cafe Owner Controls (Visibility Switch & Delete Entry)",
    mobile: false,
    needsDb: true,
    run: runOwnerControlsGate,
  },
  {
    slug: "sw-privacy",
    label: "T23: Service Worker Privacy & Network-Only Document Rules",
    mobile: false,
    needsDb: true,
    run: runSwPrivacyGate,
  },
];

/**
 * Run the registered gates serially against a single DB (D5). A gate
 * failure records its artifacts (`trace.zip`, `failure.png`, `console.log`)
 * and aborts the suite. The runner calls this once so its own function
 * stays under the cognitive-complexity budget.
 */
export async function runRegistryGates(baseCtx, { hasDb, viewport }) {
  for (const gate of E2E_GATES) {
    if (gate.needsDb && !hasDb) continue;
    if (viewport === "mobile" && !gate.mobile) continue;
    console.log(`[E2E] Running ${gate.label}...`);
    try {
      await gate.run({ label: gate.label, ...baseCtx });
    } catch (err) {
      recordGateFailure(gate.slug, err);
      throw err;
    }
    console.log(`[E2E] ok ${gate.label}`);
  }
}
