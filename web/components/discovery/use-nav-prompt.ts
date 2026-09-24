"use client";

/**
 * Fetch/answer state for the navigation return prompt (DG77/DG82/DG90).
 * Split from nav-prompt.tsx (file budget): the hook owns the lazy queue
 * lookup and the resolve POST; the view owns the card↔pill presentation.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { apiErrorMessage, apiFetch } from "@/lib/http";
import type { NavPromptItemDto } from "@shared/navigations/prompt";

/** The promptable navigation DTO served by GET /api/navigations/prompt. */
export type NavPromptItem = NavPromptItemDto;

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
 *
 * When no SW is registered or when `ready` never resolves, skip waiting or
 * time out after ~3s so the fetch degrades to network rather than hanging
 * the prompt indefinitely (BRAWUKA-580).
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
  let readyTimer: ReturnType<typeof setTimeout> | null = null;

  void (async () => {
    // If no service worker is registered for this scope, skip ready wait (BRAWUKA-580).
    if (typeof sw.getRegistration === "function") {
      try {
        const reg = await sw.getRegistration();
        if (stopped || isCancelled()) return;
        if (!reg) {
          unschedule = schedule();
          return;
        }
      } catch {
        // Ignored; fall through to ready wait with timeout
      }
    }

    // Await ready with timeout: ready never resolves if no SW activates (BRAWUKA-580).
    const SW_READY_TIMEOUT_MS = 3000;
    const timeoutPromise = new Promise<null>((resolve) => {
      readyTimer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
    });
    const reg = await Promise.race([
      sw.ready.catch(() => null),
      timeoutPromise,
    ]);
    if (readyTimer !== null) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (stopped || isCancelled()) return;

    // Poll until the active worker reports `activated` — `ready` can
    // resolve while it is still `activating`. Capped at ~5s (BRAWUKA-281
    // P2): a worker wedged in `activating`/`installed` must not spin a
    // 20Hz timer for the whole session. Past the cap, proceed to schedule
    // anyway — the fetch degrades to network rather than hanging forever.
    const MAX_ATTEMPTS = 100;
    let attempts = 0;
    while (reg?.active && reg.active.state !== "activated" && attempts < MAX_ATTEMPTS) {
      attempts += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (stopped || isCancelled()) return;
    }
    if (!stopped && !isCancelled()) unschedule = schedule();
  })();
  return () => {
    stopped = true;
    if (readyTimer !== null) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
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
  const t = useTranslations("navPrompt");
  const tApi = useTranslations();
  const [item, setItem] = useState<NavPromptItem | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, setPending] = useState<NavPromptAnswer | null>(null);

  useEffect(() => {
    if (!enabled || gone || sessionFlagRead()) return;
    let cancelled = false;
    const load = () => {
      apiFetch<{ prompt: NavPromptItem | null }>("/api/navigations/prompt")
        .then((body) => {
          if (cancelled) return;
          // The queue was consulted — one prompt per session regardless of
          // the answer (including "nothing eligible").
          sessionFlagWrite();
          if (body?.prompt) setItem(body.prompt);
        })
        .catch(() => {
          // If the prompt request fails (401 guest, 429, 5xx, or offline),
          // do NOT set the session flag so the session can retry (BRAWUKA-443).
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
        await apiFetch(`/api/navigations/${item.id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome }),
        });
        setGone(true);
        if (outcome === "visited") onCheckIn(item.cafe.id, item.cafe.name);
      } catch (err: unknown) {
        toast(apiErrorMessage(err, t("failed"), tApi), { timeout: 4000 });
      } finally {
        setPending(null);
      }
    },
    [item, pending, onCheckIn, t, tApi],
  );

  return { item: gone ? null : item, pending, answer };
}
