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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useDiscoveryController } from "@/lib/discovery/use-discovery-controller";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import type { CafeSummary } from "@/types/cafes";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import { NavPromptView } from "./nav-prompt";
import { useNavPrompt } from "./use-nav-prompt";
import { DesktopDiscovery } from "./desktop-discovery";
import { MobileSheet } from "./mobile-sheet";

async function fetchNearbyCafes(lat: number, lng: number): Promise<CafeSummary[]> {
  const res = await fetch(`/api/cafes?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error(`cafes failed: ${res.status}`);
  const body = (await res.json()) as { cafes: CafeSummary[] };
  return body.cafes;
}

export function DiscoveryHome({
  center,
  addCafe,
  initialCafeId,
  isAuthenticated,
  mapOverlay,
  children,
}: {
  /** Nearby-query center — the onboarding slice's resolved city/location,
   * or the configured `discovery.defaultCenter` fallback. */
  center: { lat: number; lng: number };
  /** Empty-state CTA slot — the existing creation trigger, auth-aware. */
  addCafe: ReactNode;
  /** Optional initial selected cafe ID (e.g. from ?cafe= query param) */
  initialCafeId?: string;
  /** Server-known auth state — forwarded to the check-in drawer's sign-in gate. */
  isAuthenticated?: boolean;
  /** Map-surface overlays (welcome card, locate button). On mobile they
   * render only while the sheet sits at PEEK so they never cover the
   * half/full detail content; on desktop they are always visible. */
  mapOverlay?: ReactNode;
  /** Surface children (e.g. landing scaffold / map) coordinated with discovery */
  children?: ReactNode;
}) {
  const t = useTranslations("discovery");
  const mounted = useMounted();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const controller = useDiscoveryController({ initialCafeId });

  const cafesQuery = useQuery({
    queryKey: ["cafes-list", center.lat, center.lng],
    queryFn: () => fetchNearbyCafes(center.lat, center.lng),
  });

  // Map overlays never cover the mobile sheet's half/full detail content.
  const overlay = mapOverlay && (isDesktop || controller.snap === "peek")
    ? mapOverlay
    : null;

  const [checkinCafe, setCheckinCafe] = useState<{
    id: string;
    name: string;
    promptCaption: boolean;
  } | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);

  const onCheckIn = (cafeId?: string, cafeName?: string, promptCaption = false) => {
    const id = cafeId ?? controller.selectedCafeId;
    if (!id) return;
    const cafe = cafesQuery.data?.find((c) => c.id === id);
    setCheckinCafe({ id, name: cafeName ?? cafe?.name ?? t("unknown_cafe"), promptCaption });
    setCheckinOpen(true);
  };

  // DG85/DG90: the prompt defers while the sheet is at FULL or the check-in
  // drawer (a modal task surface) is open; it renders once the UI returns
  // to PEEK/HALF with nothing modal above it.
  const navPrompt = useNavPrompt({
    enabled: mounted && controller.snap !== "full" && !checkinOpen,
    onCheckIn: (cafeId, cafeName) => onCheckIn(cafeId, cafeName, true),
  });
  const navPromptView = (placement: "sheet" | "surface") =>
    navPrompt.item ? (
      <NavPromptView
        item={navPrompt.item}
        pending={navPrompt.pending}
        onAnswer={navPrompt.answer}
        placement={placement}
      />
    ) : null;

  const props = {
    controller,
    cafes: cafesQuery.data ?? [],
    isLoading: cafesQuery.isPending,
    isError: cafesQuery.isError,
    onRetry: () => cafesQuery.refetch(),
    onCheckIn,
    addCafe,
    navPrompt: navPromptView("sheet"),
  };

  const checkinDrawer = checkinCafe ? (
    <CheckinDrawer
      isOpen={checkinOpen}
      onOpenChange={setCheckinOpen}
      cafeId={checkinCafe.id}
      cafeName={checkinCafe.name}
      isAuthenticated={isAuthenticated}
      promptCaption={checkinCafe.promptCaption}
    />
  ) : null;

  // Standalone mode (no surface children — the future map surface) keeps the
  // JS-gated switch: there is no landing subtree to keep stable.
  if (!children) {
    if (!mounted) return null;
    return (
      <>
        {isDesktop ? <DesktopDiscovery {...props} /> : <MobileSheet {...props} />}
        {isDesktop ? navPromptView("surface") : null}
        {overlay}
        {checkinDrawer}
      </>
    );
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
      {mounted && isDesktop ? navPromptView("surface") : null}
      {mounted ? overlay : null}
      {checkinDrawer}
    </>
  );
}
