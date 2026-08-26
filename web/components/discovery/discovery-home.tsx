"use client";

/**
 * Discovery home adapter (spec 0001: "A thin home-page adapter loads the
 * existing nearby-cafes API"). Fetches /api/cafes near the configured
 * default center (DG112: no geolocation prompt in this slice — the locate
 * button is onboarding-geolocation's persistent control), owns the shared
 * selection controller, and switches between the mobile sheet and the
 * desktop sidebar/detail columns at 1024px (18g).
 *
 * Renders nothing until mounted: the scaffold page beneath is the
 * server-rendered placeholder map surface, and discovery layers on top as
 * a client enhancement.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "@heroui/react";
import { useDiscoveryController } from "@/lib/discovery/use-discovery-controller";
import { useMediaQuery } from "@/lib/use-media-query";
import { useMounted } from "@/lib/use-mounted";
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
}: {
  /** Fallback map center (web/config/app.yaml discovery.defaultCenter). */
  defaultCenter: { lat: number; lng: number };
  /** Empty-state CTA slot — the existing creation trigger, auth-aware. */
  addCafe: ReactNode;
  /** Optional initial selected cafe ID (e.g. from ?cafe= query param) */
  initialCafeId?: string;
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

  if (!mounted) return null;

  const props = {
    controller,
    cafes: cafesQuery.data ?? [],
    isLoading: cafesQuery.isPending,
    onCheckIn,
    addCafe,
  };
  return isDesktop ? <DesktopDiscovery {...props} /> : <MobileSheet {...props} />;
}
