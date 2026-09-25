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
import { runAuthSessionGate } from "./auth-session-gate.mjs";
import { runCafeCreationGate } from "./cafe-creation-gate.mjs";
import { runCheckinDrawerGate } from "./checkin-drawer-gate.mjs";
import { runCheckinLifecycleGate } from "./checkin-lifecycle-gate.mjs";
import { runCheckinSubmitGate } from "./checkin-submit-gate.mjs";
import { runDeeplinkHydrationGate } from "./deeplink-hydration-gate.mjs";
import { runNavigationPromptGate } from "./navigation-prompt-gate.mjs";
import { runCityScopeGate } from "./city-scope-gate.mjs";
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
    slug: "auth-session",
    label: "T1/T2/T3: Auth Session (Entry, Banner, Sign-out, Delete)",
    mobile: true,
    needsDb: true,
    run: runAuthSessionGate,
  },
  {
    slug: "cafe-creation",
    label: "T5: Cafe Creation (POI Search, Create, Detail)",
    mobile: false,
    needsDb: true,
    run: runCafeCreationGate,
  },
  {
    slug: "checkin-lifecycle",
    label: "T9/T10/T11: Check-in Edit, Delete, Like Toggle",
    mobile: false,
    needsDb: true,
    run: runCheckinLifecycleGate,
  },
  {
    slug: "navigation-prompt",
    label: "T13: Navigation Return Prompt (Queue, Answer)",
    mobile: false,
    needsDb: true,
    run: runNavigationPromptGate,
  },
  {
    slug: "city-scope",
    label: "T14: City Scope (Forged Name Precedence, rt-* Coordinate Search)",
    mobile: false,
    needsDb: true,
    run: runCityScopeGate,
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
