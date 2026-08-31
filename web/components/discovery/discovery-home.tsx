"use client";

/**
 * Discovery home adapter (spec 0001: "A thin home-page adapter loads the
 * existing nearby-cafes API"). Fetches /api/cafes near the configured
 * default center (DG112: no geolocation prompt in this slice — the locate
 * button is onboarding-geolocation's persistent control), owns the shared
 * selection controller, and switches between the mobile sheet and the
 * desktop sidebar/detail columns at 1024px (18g).
 *
 * SSR/hydration contract (#275): in landing mode (children present) the
 * partitioned shell renders on the very first pass — the desktop sidebar
 * shell is CSS-gated (`hidden lg:flex`), so SSR already reserves the 380px
 * column and neither mounting nor crossing the 1024px breakpoint ever
 * re-parents, remounts, or shifts the landing subtree. Mounting gates only
 * the interactive content (list, detail column, MobileSheet), never the
 * tree shape.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "@heroui/react";
import { useDiscoveryController } from "@/lib/discovery/use-discovery-controller";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import type { CafeSummary } from "@/types/cafes";
import { DesktopDiscovery } from "./desktop-discovery";
import { MobileSheet } from "./mobile-sheet";

async function fetchNearbyCafes(lat: number, lng: number): Promise<CafeSummary[]> {
  const res = await fetch(`/api/cafes?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error(`cafes failed: ${res.status}`);
  const body = (await res.json()) as { cafes: CafeSummary[] };
  return body.cafes;
}

export function DiscoveryHome({
  defaultCenter,
  addCafe,
  initialCafeId,
  children,
}: {
  /** Fallback map center (web/config/app.yaml discovery.defaultCenter). */
  defaultCenter: { lat: number; lng: number };
  /** Empty-state CTA slot — the existing creation trigger, auth-aware. */
  addCafe: ReactNode;
  /** Optional initial selected cafe ID (e.g. from ?cafe= query param) */
  initialCafeId?: string;
  /** Surface children (e.g. landing scaffold / map) coordinated with discovery */
  children?: ReactNode;
}) {
  const t = useTranslations("discovery");
  const mounted = useMounted();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const controller = useDiscoveryController({ initialCafeId });

  const cafesQuery = useQuery({
    queryKey: ["cafes-list", defaultCenter.lat, defaultCenter.lng],
    queryFn: () => fetchNearbyCafes(defaultCenter.lat, defaultCenter.lng),
  });

  // Interim: the check-in composer is checkin-system's drawer (#133 scope
  // boundary). Until that slice lands, Check in explains itself instead of
  // being a dead button.
  const onCheckIn = () => toast(t("checkin_coming"), { timeout: 4000 });

  const props = {
    controller,
    cafes: cafesQuery.data ?? [],
    isLoading: cafesQuery.isPending,
    onCheckIn,
    addCafe,
  };

  // Standalone mode (no surface children — the future map surface) keeps the
  // JS-gated switch: there is no landing subtree to keep stable.
  if (!children) {
    if (!mounted) return null;
    return isDesktop ? <DesktopDiscovery {...props} /> : <MobileSheet {...props} />;
  }

  // Landing mode: one stable tree across SSR, mount, and breakpoint changes
  // (#275). The sidebar shell is always rendered and CSS-gated inside
  // DesktopDiscovery; mounting gates only its interactive content and the
  // MobileSheet overlay.
  return (
    <>
      <DesktopDiscovery {...props} showColumns={mounted && isDesktop}>
        {children}
      </DesktopDiscovery>
      {mounted && !isDesktop ? <MobileSheet {...props} /> : null}
    </>
  );
}
