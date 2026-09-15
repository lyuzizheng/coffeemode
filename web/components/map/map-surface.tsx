"use client";

/**
 * Map surface entry (map-home, BRAWUKA-311). Client-only: the maplibre chunk
 * loads via next/dynamic ssr:false — SSR renders the skeleton in the same
 * flex-1 slot so the landing tree never re-parents (#275 contract).
 *
 * Failure containment: a basemap outage (tile host down, WebGL missing,
 * chunk load failure) degrades this slot to an error card; the discovery
 * sheet/sidebar keeps working because the data path never touches the map.
 */
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { WarningIcon } from "@/components/icons";

const DiscoveryMap = dynamic(
  () => import("./discovery-map").then((m) => m.DiscoveryMap),
  { ssr: false, loading: () => <MapSkeleton /> },
);

/** Reserved map area while the maplibre chunk loads — quiet paper tint with
 * a single pulsing pin, no spinner chrome. */
function MapSkeleton() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-surface-secondary"
      aria-hidden
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        className="animate-pulse text-muted/50"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="18" cy="18" r="12" />
        <path d="M13 15h8v3.5a4 4 0 0 1-8 0z" fill="currentColor" stroke="none" />
        <path d="M21 15.8h1.4a2.2 2.2 0 0 1 0 4.4H21" />
        <path d="M12.5 24h11" />
      </svg>
    </div>
  );
}

/** Basemap failure card — the sheet stays fully usable (DG: data path is
 * map-independent), so this is a calm inline state, not a blocking screen. */
function MapErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("map");
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary p-6">
      <div
        role="alert"
        className="flex max-w-xs flex-col items-start gap-2 rounded-md border border-separator bg-surface p-4"
      >
        <div className="flex items-center gap-2">
          <WarningIcon size={16} className="shrink-0 text-muted" />
          <p className="text-sm font-medium text-foreground">{t("error_title")}</p>
        </div>
        <p className="text-sm leading-relaxed text-muted">{t("error_body")}</p>
        <Button variant="outline" size="sm" onPress={onRetry} className="mt-1">
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}

/** Chunk-load / render failures inside the dynamic map land here. */
class MapErrorBoundary extends Component<
  { onFailure: (err: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    this.props.onFailure(err);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function MapSurface() {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // Defer the ~1MB maplibre chunk + map init until the main thread is idle:
  // the skeleton paints immediately (it is the LCP candidate), and the heavy
  // module evaluation stays out of the TBT window (Lighthouse gate, BRAWUKA-311
  // review P0). requestIdleCallback with a timeout fallback — Safari lacks rIC.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ric = window.requestIdleCallback;
    const id =
      typeof ric === "function"
        ? ric(() => setIdle(true), { timeout: 1500 })
        : window.setTimeout(() => setIdle(true), 0);
    return () => {
      if (typeof ric === "function") window.cancelIdleCallback(id as number);
      else window.clearTimeout(id as number);
    };
  }, []);

  const handleFailure = useCallback((err: unknown) => {
    console.error("[map] basemap failed:", err);
    setFailed(true);
  }, []);
  const handleRetry = useCallback(() => {
    setFailed(false);
    setRetryKey((k) => k + 1);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      {failed ? (
        <MapErrorState onRetry={handleRetry} />
      ) : idle ? (
        <MapErrorBoundary key={retryKey} onFailure={handleFailure}>
          <DiscoveryMap onError={handleFailure} />
        </MapErrorBoundary>
      ) : (
        <MapSkeleton />
      )}
    </div>
  );
}
