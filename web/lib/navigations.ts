"use client";

import { apiFetch } from "@/lib/http";

/**
 * Client-side navigation recording (spec 0001 §Check-in system, DG76).
 * The "导航" tap fires this alongside the maps deep link; the row it writes
 * is what the return-visit prompt queue (web/lib/prompt-queue) later serves.
 * Fire-and-forget by design: a failed record must never block or annotate
 * the user's navigation — the funnel tolerates a lost row, the user does
 * not tolerate a broken Navigate button. Anonymous sessions 401 until
 * Supabase anonymous sign-in lands; that is the DG76 contract, not a bug.
 */
export function recordNavigationTap(cafeId: string): void {
  void apiFetch("/api/navigations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cafe_id: cafeId }),
  }).catch(() => {
    // Offline or unauthenticated: the deep link already opened — swallow.
  });
}
