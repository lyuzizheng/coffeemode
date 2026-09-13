"use client";

/**
 * Fetch/answer state for the navigation return prompt (DG77/DG82/DG90).
 * Split from nav-prompt.tsx (file budget): the hook owns the lazy queue
 * lookup and the resolve POST; the view owns the card↔pill presentation.
 */
import { useCallback, useEffect, useState } from "react";

/** The promptable navigation DTO served by GET /api/navigations/prompt. */
export interface NavPromptItem {
  id: string;
  created_at: string;
  cafe: { id: string; name: string; cover: string | null };
}

export type NavPromptAnswer = "visited" | "wont_go" | "not_yet";

/** One prompt per session (DG82) — set once the queue has been consulted. */
const SESSION_KEY = "cm_nav_prompt_shown";

function sessionFlagRead(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false; // blocked storage degrades to "can prompt"
  }
}

function sessionFlagWrite(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Benign: private mode — the worst case is a second fetch this session.
  }
}
/**
 * DG77: lazy — after the surface reaches idle, never on the render path.
 * The fetch also waits until the service worker is fully `activated`:
 * a request issued while the SW is still `activating` wedges inside its
 * fetch handler and never settles (visual-smoke networkidle hang,
 * BRAWUKA-5). `controller`/`controllerchange` fires during `activating`,
 * so the reliable gate is `sw.ready` + `active.state === "activated"`.
 */
function schedulePromptLoad(load: () => void, isCancelled: () => boolean): () => void {
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(load, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(load, 1500);
    return () => window.clearTimeout(handle);
  };
  const sw = navigator.serviceWorker;
  if (!sw || sw.controller) return schedule();
  let unschedule: (() => void) | null = null;
  let stopped = false;
  void (async () => {
    const reg = await sw.ready;
    // Poll until the active worker reports `activated` — `ready` can
    // resolve while it is still `activating`.
    while (reg.active && reg.active.state !== "activated") {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (stopped || isCancelled()) return;
    }
    if (!stopped && !isCancelled()) unschedule = schedule();
  })();
  return () => {
    stopped = true;
    unschedule?.();
  };
}


export function useNavPrompt({
  enabled,
  onCheckIn,
}: {
  /** Host-side deferral (DG85/DG90): sheet at PEEK/HALF, no modal open. */
  enabled: boolean;
  /** 有去！ enters the target cafe's check-in flow with the DG92 caption. */
  onCheckIn: (cafeId: string, cafeName: string) => void;
}) {
  const [item, setItem] = useState<NavPromptItem | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, setPending] = useState<NavPromptAnswer | null>(null);

  useEffect(() => {
    if (!enabled || gone || sessionFlagRead()) return;
    let cancelled = false;
    const load = () => {
      fetch("/api/navigations/prompt")
        .then(async (res) => {
          if (cancelled) return;
          // The queue was consulted — one prompt per session regardless of
          // the answer (including "nothing eligible").
          sessionFlagWrite();
          // 401 (guest — anonymous sign-in pending, DG76), 429, 5xx: a
          if (!res.ok) {
            // Consume the body: an unread SW-proxied response stream keeps
            // the request "pending" in the network stack forever (breaks
            // networkidle, BRAWUKA-5 visual-smoke hang).
            await res.body?.cancel().catch(() => {});
            return;
          }
          const body = (await res.json()) as { prompt: NavPromptItem | null };
          if (body.prompt) setItem(body.prompt);
        })
        .catch(() => {
          // Offline: stay silent; the next session retries.
        });
    };
    const unschedule = schedulePromptLoad(load, () => cancelled);
    return () => {
      cancelled = true;
      unschedule();
    };
  }, [enabled, gone]);

  const answer = useCallback(
    async (outcome: NavPromptAnswer) => {
      if (!item || pending) return;
      setPending(outcome);
      try {
        await fetch(`/api/navigations/${item.id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome }),
        });
      } catch {
        // Offline: dismiss anyway — an unresolved row simply becomes
        // eligible again on a later session; the card never traps the user.
      }
      setPending(null);
      setGone(true);
      if (outcome === "visited") onCheckIn(item.cafe.id, item.cafe.name);
    },
    [item, pending, onCheckIn],
  );

  return { item: gone ? null : item, pending, answer };
}
