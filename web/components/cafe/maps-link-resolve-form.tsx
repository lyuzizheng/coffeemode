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

export function MapsLinkResolveForm({ active, onSelectPOI, onError }: MapsLinkResolveFormProps) {
  const t = useTranslations("create");
  const [mapsUrl, setMapsUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { turnstileReady, widgetIdRef } = useResolveTurnstile(active, containerRef, onError, t);

  const handleResolveLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!mapsUrl.trim()) return;
    const sitekey = getTurnstileSiteKey();
    const widgetId = widgetIdRef.current;
    let turnstileToken: string | null = null;
    if (sitekey) {
      if (!turnstileReady || !widgetId) {
        onError(t("resolveFailed"));
        return;
      }
      try {
        turnstileToken = await executeWidgetForToken(widgetId);
      } catch {
        onError(t("resolveFailed"));
        return;
      }
    }
    setBusy(true);
    onError(null);
    try {
      const resolvedPoi = await apiFetch<POI>("/api/places/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maps_share_url: mapsUrl.trim(),
          ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
        }),
      });
      onSelectPOI(resolvedPoi);
    } catch (cause) {
      onError(apiErrorMessage(cause, t("resolveFailed")));
    } finally {
      setBusy(false);
      if (sitekey && widgetId) {
        try {
          await resetResolveWidget(widgetId);
        } catch {
          // Benign: reset failure only affects the next retry token freshness.
        }
      }
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
      {/* Invisible Turnstile challenge host for POST /api/places/resolve. */}
      <div ref={containerRef} aria-hidden="true" />
    </form>
  );
}
