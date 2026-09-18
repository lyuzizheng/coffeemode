/**
 * Profile onboarding-guide dismissal (BRAWUKA-504): the zero-data profile
 * shows a three-step starter card instead of four empty tabs; skipping it
 * (or having data) must never bring it back (DG39 — no nag surfaces).
 *
 * localStorage, same quota-safe pattern as onboarding-store.ts: a blocked
 * or corrupt read degrades to "not dismissed" — the card reappearing once
 * is a nuisance, never a gate.
 */

const DISMISS_KEY = "coffeemode:profile-guide-dismissed:v1";

export function hasDismissedProfileGuide(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissProfileGuide(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Best-effort; a repeat card is a nuisance, not a bug.
  }
}
