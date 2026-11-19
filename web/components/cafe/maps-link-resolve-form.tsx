"use client";

import { Button, Input, Label, Spinner, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { apiErrorMessage, apiFetch } from "@/lib/http";
import {
  executeWidgetForToken,
  getTurnstileSiteKey,
  removeResolveWidget,
  renderInvisibleResolveWidget,
  resetResolveWidget,
} from "@/lib/security/turnstile-client";
import type { POI } from "@shared/places/types";
import type { CreateTranslator } from "@/lib/places/place-search";

interface MapsLinkResolveFormProps {
  /** Owned by the coordinator's tab state. The form stays mounted when
   * inactive so the entered URL survives tab switches; `active` alone drives
   * the Turnstile widget lifecycle and visibility. */
  active: boolean;
  onSelectPOI: (poi: POI, persist?: boolean) => void;
  onError: (error: string | null) => void;
}

// Invisible Turnstile widget for the maps-link resolve (BRAWUKA-239):
// rendered once while the link tab is active, executed per submit so
// every POST carries a fresh single-use token; reset after each attempt
// so retries mint a new one. Skipped when no sitekey is configured.
function useResolveTurnstile(
  active: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  onError: (error: string | null) => void,
  t: CreateTranslator,
) {
  const [turnstileReady, setTurnstileReady] = useState(false);
  const widgetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const sitekey = getTurnstileSiteKey();
    const container = containerRef.current;
    if (!sitekey || !container) return;
    let cancelled = false;
    let widgetId: string | null = null;
    renderInvisibleResolveWidget(container, sitekey)
      .then((id) => {
        if (cancelled) {
          removeResolveWidget(id);
          return;
        }
        widgetId = id;
        widgetIdRef.current = id;
        setTurnstileReady(true);
      })
      .catch(() => {
        if (!cancelled) onError(t("resolveFailed"));
      });
    return () => {
      cancelled = true;
      setTurnstileReady(false);
      widgetIdRef.current = null;
      if (widgetId) removeResolveWidget(widgetId);
    };
  }, [active, containerRef, onError, t]);
  return { turnstileReady, widgetIdRef };
}

type ResolveOutcome = { ok: true; poi: POI } | { ok: false; error: string };

interface ResolveWidgetState {
  sitekey: string | null;
  widgetId: string | null;
  ready: boolean;
}

/**
 * Challenge plus resolve POST for one submit. Never throws: every failure
 * becomes an `error` the caller shows, so one dead end cannot skip the
 * widget reset that follows.
 */
async function resolveMapsLink(
  mapsUrl: string,
  widget: ResolveWidgetState,
  t: CreateTranslator,
): Promise<ResolveOutcome> {
  let turnstileToken: string | null = null;
  if (widget.sitekey) {
    if (!widget.ready || !widget.widgetId) return { ok: false, error: t("resolveFailed") };
    try {
      turnstileToken = await executeWidgetForToken(widget.widgetId);
    } catch {
      return { ok: false, error: t("resolveFailed") };
    }
  }
  try {
    const poi = await apiFetch<POI>("/api/places/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        maps_share_url: mapsUrl,
        ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
      }),
    });
    return { ok: true, poi };
  } catch (cause) {
    return { ok: false, error: apiErrorMessage(cause, t("resolveFailed")) };
  }
}

export function MapsLinkResolveForm({ active, onSelectPOI, onError }: MapsLinkResolveFormProps) {
  const t = useTranslations("create");
  const [mapsUrl, setMapsUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { turnstileReady, widgetIdRef } = useResolveTurnstile(active, containerRef, onError, t);

  const handleResolveLink = async (event: FormEvent) => {
    event.preventDefault();
    // The lock must come before the challenge, not after it (BRAWUKA-1021 P1):
    // `busy` only disables the button on the next render, so a rapid repeat
    // submit would run a second `execute()` on one widget and strand the first
    // token promise. The ref closes that same-tick window.
    if (!mapsUrl.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    onError(null);
    const sitekey = getTurnstileSiteKey();
    const widgetId = widgetIdRef.current;
    try {
      const outcome = await resolveMapsLink(
        mapsUrl.trim(),
        { sitekey, widgetId, ready: turnstileReady },
        t,
      );
      if (outcome.ok) onSelectPOI(outcome.poi);
      else onError(outcome.error);
    } finally {
      // Reset before releasing the lock: a submit that starts while the widget
      // is being reset would have its challenge cleared and time out.
      if (sitekey && widgetId) {
        try {
          await resetResolveWidget(widgetId);
        } catch {
          // Benign: reset failure only affects the next retry token freshness.
        }
      }
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="space-y-3" hidden={!active} onSubmit={handleResolveLink}>
      <p className="text-sm text-muted">{t("importHint")}</p>
      <div className="flex gap-2">
        <TextField className="min-w-0 flex-1">
          <Label className="sr-only">{t("mapsLink")}</Label>
          <Input
            value={mapsUrl}
            onChange={(event) => setMapsUrl(event.target.value)}
            placeholder={t("mapsLinkPlaceholder")}
            type="url"
          />
        </TextField>
        <Button type="submit" variant="secondary" isDisabled={busy || !mapsUrl.trim()}>
          {busy ? <Spinner size="sm" /> : t("resolveLink")}
        </Button>
      </div>
      {/* Turnstile challenge host for POST /api/places/resolve. Hidden unless
          Turnstile requires an interaction, so it must stay reachable by
          assistive tech when it does appear. */}
      <div ref={containerRef} />
    </form>
  );
}
