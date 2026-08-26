"use client";

/**
 * Discovery selection controller (spec 0001 §Discovery, spec 0004 18b–18g).
 *
 * Provider-neutral: owns selectedCafeId, the mobile snap state, URL history,
 * and focus handoff. Map bindings subscribe later (map-discovery-integration);
 * the SSR /cafes/[id] route is owned by seo-sharing — the URLs pushed here are
 * the canonical cafe URLs that route will serve.
 *
 * URL contract (DG14):
 *   - first selection pushes ONE /cafes/[id] history entry;
 *   - changing the cafe or the snap state replaces that entry;
 *   - browser Back collapses the whole selection session to `/` (popstate),
 *     and Forward re-selects the cafe named by the URL — no loops, no spam.
 *
 * PEEK is the no-selection state: stepping down from HALF clears the
 * selection (spec 0004 18b), so `snap` derives from selection + height.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@heroui/react";
import { isValidUUID } from "@shared/uuid";

export type SheetSnap = "peek" | "half" | "full";

const CAFE_PATH = /^\/cafes\/([0-9a-fA-F-]{36})$/;

/** Parse a `/cafes/<uuid>` pathname; null for anything else. */
export function cafeIdFromPath(pathname: string): string | null {
  const match = CAFE_PATH.exec(pathname);
  if (!match) return null;
  const id = match[1].toLowerCase();
  return isValidUUID(id) ? id : null;
}

export interface DiscoveryController {
  selectedCafeId: string | null;
  snap: SheetSnap;
  /** Card/row tap: selects the cafe and opens HALF (mobile) / the detail column. */
  select: (cafeId: string) => void;
  /** Sheet snap from a drag end: up steps HALF→FULL; down steps FULL→HALF→PEEK. */
  snapTo: (snap: SheetSnap) => void;
  /** Close (×, Esc, gesture into PEEK): clears selection, URL replaces to `/`. */
  close: () => void;
  /** In-app missing cafe (DG19/18f): toast + close. */
  handleMissingCafe: () => void;
  /** Register the source card/row element so Close can restore focus (18e). */
  registerCardRef: (cafeId: string, el: HTMLElement | null) => void;
  /** Ref callback for the detail heading; selection moves focus here. */
  detailHeadingRef: (el: HTMLElement | null) => void;
}

export function useDiscoveryController(options?: { initialCafeId?: string }): DiscoveryController {
  const t = useTranslations("discovery");
  const initialValidId =
    options?.initialCafeId && isValidUUID(options.initialCafeId)
      ? options.initialCafeId.toLowerCase()
      : null;

  const [selectedCafeId, setSelectedCafeId] = useState<string | null>(initialValidId);
  const [snap, setSnap] = useState<SheetSnap>(() => (initialValidId ? "half" : "peek"));
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const headingEl = useRef<HTMLElement | null>(null);
  const focusPending = useRef(Boolean(initialValidId));
  const restoreFocusTo = useRef<string | null>(null);

  // --- URL sync -----------------------------------------------------------
  // History writes are side effects: they must NOT live inside setState
  // updaters (StrictMode double-invokes updaters, which would push duplicate
  // entries — and Next's patched history sets Router state during render).
  const cafeUrl = (id: string) => `/cafes/${id}`;

  const select = useCallback(
    (cafeId: string) => {
      if (selectedCafeId === null) {
        // First selection of the session: one pushed entry.
        window.history.pushState(null, "", cafeUrl(cafeId));
      } else if (selectedCafeId !== cafeId) {
        window.history.replaceState(null, "", cafeUrl(cafeId));
      }
      setSelectedCafeId(cafeId);
      setSnap((prev) => (prev === "full" ? "full" : "half"));
      focusPending.current = true;
    },
    [selectedCafeId],
  );

  const close = useCallback(() => {
    if (selectedCafeId !== null) {
      restoreFocusTo.current = selectedCafeId;
      window.history.replaceState(null, "", "/");
    }
    setSelectedCafeId(null);
    setSnap("peek");
  }, [selectedCafeId]);

  const snapTo = useCallback(
    (next: SheetSnap) => {
      if (next === "peek") {
        close();
        return;
      }
      // Height changes replace the selection entry (no history spam).
      if (next !== snap && selectedCafeId) {
        window.history.replaceState(null, "", cafeUrl(selectedCafeId));
      }
      setSnap(next);
    },
    [close, selectedCafeId, snap],
  );

  const handleMissingCafe = useCallback(() => {
    toast(t("missing_cafe"), { timeout: 4000 });
    close();
  }, [close, t]);

  // Normalize initial ?cafe= deep link to canonical /cafes/[id], and attach Back/Forward popstate listener.
  useEffect(() => {
    if (initialValidId) {
      window.history.replaceState(null, "", cafeUrl(initialValidId));
    }

    const onPopState = () => {
      const id = cafeIdFromPath(window.location.pathname);
      if (id) {
        setSelectedCafeId(id);
        setSnap((prev) => (prev === "peek" ? "half" : prev));
        focusPending.current = true;
      } else {
        setSelectedCafeId(null);
        setSnap("peek");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialValidId]);

  // --- Focus handoff (non-modal, DG18) ------------------------------------
  const registerCardRef = useCallback((cafeId: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(cafeId, el);
    else cardRefs.current.delete(cafeId);
  }, []);

  const detailHeadingRef = useCallback((el: HTMLElement | null) => {
    headingEl.current = el;
  }, []);

  useEffect(() => {
    if (focusPending.current && selectedCafeId && headingEl.current) {
      focusPending.current = false;
      headingEl.current.focus();
    }
  }, [selectedCafeId, snap]);

  useEffect(() => {
    if (selectedCafeId === null && restoreFocusTo.current) {
      const el = cardRefs.current.get(restoreFocusTo.current);
      restoreFocusTo.current = null;
      // The card may be gone (list refetch) — restore only when it exists.
      el?.focus();
    }
  }, [selectedCafeId]);

  return {
    selectedCafeId,
    snap,
    select,
    snapTo,
    close,
    handleMissingCafe,
    registerCardRef,
    detailHeadingRef,
  };
}
