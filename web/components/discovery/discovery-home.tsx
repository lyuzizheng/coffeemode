"use client";

/**
 * Discovery home adapter (spec 0001: "A thin home-page adapter loads the
 * existing nearby-cafes API"). Fetches /api/cafes near the configured
 * default center (DG112: no geolocation prompt in this slice — the locate
 * button is onboarding-geolocation's persistent control), owns the shared
 * selection controller, and switches between the mobile sheet and the
 * desktop sidebar/detail columns at 1024px (18g).
 *
 * BRAWUKA-364 field-guide redesign: the adapter also owns the live unified
 * search (sidebar field on desktop, floating capsule on mobile), the
 * add-cafe FAB, and the search→creation handoff — a POI result opens the
 * creation sheet prefilled; a cafe result selects it and merges it into
 * the map's dataset so the camera can fly to a cafe outside the nearby
 * list.
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
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useDiscoveryController } from "@/lib/discovery/use-discovery-controller";
import { DiscoveryMapContext } from "@/lib/discovery/map-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import type { CafeSummary } from "@/types/cafes";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import { CafeCreationSheet } from "@/components/cafe/cafe-creation-sheet";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import { NavPromptView } from "./nav-prompt";
import { useNavPrompt } from "./use-nav-prompt";
import { useDiscoverySearch } from "./use-discovery-search";
import type { DiscoverySearch } from "./use-discovery-search";
import type { CreationDraft } from "./use-discovery-search";
import { DesktopDiscovery } from "./desktop-discovery";
import { MobileSheet, PEEK_VISIBLE_PX } from "./mobile-sheet";

async function fetchNearbyCafes(lat: number, lng: number): Promise<CafeSummary[]> {
  const res = await fetch(`/api/cafes?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error(`nearby cafes failed: ${res.status}`);
  const data = (await res.json()) as { cafes: CafeSummary[] };
  return data.cafes;
}

/** Map overlays never cover the mobile sheet's half/full detail content. */
function gateMapOverlay(
  mapOverlay: ReactNode | undefined,
  isDesktop: boolean,
  snap: string,
): ReactNode {
  return mapOverlay && (isDesktop || snap === "peek" || snap === "collapsed") ? mapOverlay : null;
}

/** The floating capsule search over the mobile map (BRAWUKA-364). */
function MobileSearchOverlay({
  search,
  onQueryChange,
  resultsActive,
}: {
  search: DiscoverySearch;
  onQueryChange: (query: string) => void;
  resultsActive: boolean;
}) {
  const t = useTranslations("map");
  return (
    <div className="fixed inset-x-4 top-4 z-40 lg:hidden" role="search" aria-label={t("search_aria")}>
      <div className="rounded-lg border border-separator bg-overlay p-2 shadow-lg">
        <UnifiedSearchPanel
          externalSources={search.externalSources}
          mapkitConfigured={search.mapkitConfigured}
          city={search.city}
          onSelectResult={search.onSelectResult}
          onExternalSearch={search.onExternalSearch}
          onQueryChange={onQueryChange}
          hideIdleHint
          resultsClassName={
            resultsActive ? "max-h-[55dvh] overflow-y-auto overscroll-contain" : undefined
          }
        />
      </div>
    </div>
  );
}

/** Everything floating above the map + columns: check-in drawer, creation
 * sheet, add-cafe FAB, and the mobile search capsule. */
function DiscoveryOverlays({
  checkinCafe,
  checkinOpen,
  setCheckinOpen,
  creationDraft,
  creationOpen,
  setCreationOpen,
  isAuthenticated,
  mapkitConfigured,
  fab,
  isDesktop,
  mobileSearch,
}: {
  checkinCafe: { id: string; name: string; promptCaption: boolean } | null;
  checkinOpen: boolean;
  setCheckinOpen: (open: boolean) => void;
  creationDraft: CreationDraft | null;
  creationOpen: boolean;
  setCreationOpen: (open: boolean) => void;
  isAuthenticated: boolean;
  mapkitConfigured: boolean;
  fab: ReactNode;
  isDesktop: boolean;
  mobileSearch: ReactNode;
}) {
  return (
    <>
      {mobileSearch}
      {fab ? (
        <div
          className="fixed right-4 z-40 lg:right-6"
          style={{
            bottom: isDesktop
              ? "1.5rem"
              : `calc(${PEEK_VISIBLE_PX}px + 16px + env(safe-area-inset-bottom))`,
          }}
        >
          {fab}
        </div>
      ) : null}
      {checkinCafe ? (
        <CheckinDrawer
          isOpen={checkinOpen}
          onOpenChange={setCheckinOpen}
          cafeId={checkinCafe.id}
          cafeName={checkinCafe.name}
          isAuthenticated={isAuthenticated}
          promptCaption={checkinCafe.promptCaption}
        />
      ) : null}
      <CafeCreationSheet
        key={creationDraft?.poi ? `${creationDraft.poi.source}:${creationDraft.poi.place_id}` : (creationDraft?.provider ?? "empty")}
        isOpen={creationOpen}
        onOpenChange={setCreationOpen}
        isAuthenticated={isAuthenticated}
        mapkitConfigured={mapkitConfigured}
        initialPoi={creationDraft?.poi ?? null}
        initialPersist={creationDraft?.persist ?? false}
        initialProvider={creationDraft?.provider ?? null}
      />
    </>
  );
}

export function DiscoveryHome({
  center,
  addCafe,
  addCafeFab,
  initialCafeId,
  isAuthenticated,
  mapkitConfigured = false,
  city,
  mapOverlay,
  children,
}: {
  /** Nearby-query center — the onboarding slice's resolved city/location,
   * or the configured `discovery.defaultCenter` fallback. */
  center: { lat: number; lng: number };
  /** Empty-state CTA slot — the existing creation trigger, auth-aware. */
  addCafe: ReactNode;
  /** Round add-cafe FAB slot (BRAWUKA-364): floats above the sheet at PEEK
   * on mobile, bottom-right on desktop. */
  addCafeFab?: ReactNode;
  /** Optional initial selected cafe ID (e.g. from ?cafe= query param) */
  initialCafeId?: string;
  /** Server-known auth state — forwarded to the check-in drawer's sign-in gate. */
  isAuthenticated?: boolean;
  /** DG143 request-time MapKit readiness — gates the Apple search CTA and
   * the creation sheet's provider tabs. */
  mapkitConfigured?: boolean;
  /** Effective city scope for search (DG128). */
  city?: string;
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

  const overlay = gateMapOverlay(mapOverlay, isDesktop, controller.snap);
  const fab = gateMapOverlay(addCafeFab, isDesktop, controller.snap);

  const [checkinCafe, setCheckinCafe] = useState<{
    id: string;
    name: string;
    promptCaption: boolean;
  } | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);

  const nearbyCafes = useMemo(() => cafesQuery.data ?? [], [cafesQuery.data]);
  const { search, mapCafes, creationDraft, creationOpen, setCreationOpen } =
    useDiscoverySearch({ controller, nearbyCafes, mapkitConfigured, city });

  const onCheckIn = (cafeId?: string, cafeName?: string, promptCaption = false) => {
    const id = cafeId ?? controller.selectedCafeId;
    if (!id) return;
    const cafe = mapCafes.find((c) => c.id === id);
    setCheckinCafe({ id, name: cafeName ?? cafe?.name ?? t("unknown_cafe"), promptCaption });
    setCheckinOpen(true);
  };

  // Mobile search: the floating capsule mirrors the field's query so the
  // results card only floats while a query is active.
  const [mobileQuery, setMobileQuery] = useState("");
  const mobileSearchActive = mobileQuery.trim().length > 0;

  // DG85/DG90: the prompt defers while the sheet is at FULL or the check-in
  // drawer (a modal task surface) is open; it renders once the UI returns
  // to PEEK/HALF with nothing modal above it.
  const navPrompt = useNavPrompt({
    enabled: mounted && controller.snap !== "full" && controller.snap !== "collapsed" && !checkinOpen,
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

  const distanceM = mapCafes.find((c) => c.id === controller.selectedCafeId)?.distance_m;

  const props = {
    controller,
    cafes: nearbyCafes,
    isLoading: cafesQuery.isPending,
    isError: cafesQuery.isError,
    onRetry: () => cafesQuery.refetch(),
    onCheckIn,
    addCafe,
    navPrompt: navPromptView("sheet"),
    distanceM,
    search,
  };

  // The map surface (children) reads controller/cafes/center through context
  // — it mounts inside this tree, so no prop-drilling through the page.
  const mapState = { controller, cafes: mapCafes, center };
  const overlays = (
    <DiscoveryOverlays
      checkinCafe={checkinCafe}
      checkinOpen={checkinOpen}
      setCheckinOpen={setCheckinOpen}
      creationDraft={creationDraft}
      creationOpen={creationOpen}
      setCreationOpen={setCreationOpen}
      isAuthenticated={isAuthenticated ?? false}
      mapkitConfigured={mapkitConfigured}
      fab={fab}
      isDesktop={isDesktop}
      mobileSearch={
        mounted && !isDesktop && (controller.snap === "peek" || controller.snap === "collapsed") ? (
          <MobileSearchOverlay
            search={search}
            onQueryChange={setMobileQuery}
            resultsActive={mobileSearchActive}
          />
        ) : null
      }
    />
  );

  // Standalone mode (no surface children) keeps the JS-gated switch.
  if (!children) {
    if (!mounted) return null;
    return (
      <DiscoveryMapContext.Provider value={mapState}>
        {isDesktop ? <DesktopDiscovery {...props} /> : <MobileSheet {...props} />}
        {isDesktop ? navPromptView("surface") : null}
        {overlay}
        {overlays}
      </DiscoveryMapContext.Provider>
    );
  }

  // Landing mode: one stable tree across SSR, mount, and breakpoint changes
  // (#275). The sidebar shell is always rendered and CSS-gated inside
  // DesktopDiscovery; mounting gates only its interactive content and the
  // MobileSheet overlay.
  return (
    <DiscoveryMapContext.Provider value={mapState}>
      <DesktopDiscovery {...props} showColumns={mounted && isDesktop}>
        {children}
      </DesktopDiscovery>
      {mounted && !isDesktop ? <MobileSheet {...props} /> : null}
      {mounted && isDesktop ? navPromptView("surface") : null}
      {mounted ? overlay : null}
      {overlays}
    </DiscoveryMapContext.Provider>
  );
}
