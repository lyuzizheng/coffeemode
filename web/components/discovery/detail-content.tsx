"use client";

/**
 * Cafe dossier — HALF (artifact §5.2) and FULL (§5.3), recomposed for the
 * field-guide redesign (BRAWUKA-364). The same FULL content renders inside
 * the mobile sheet and the desktop detail column (DG42): a cover hero (or
 * monogram plate), display name, verdict plates, labeled data sections,
 * and the check-in feed. Selection focuses the detail heading (DG18).
 */
import { Fragment, useEffect, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { CloseIcon } from "@/components/icons";
import { GalleryStrip } from "@/components/cafe/gallery-strip";
import { OpenState } from "@/components/cafe/open-state";
import { CafeOwnerControls } from "@/components/cafe/cafe-owner-controls";
import { PrivateBadge } from "@/components/cafe/private-badge";
import { ShareControl } from "@/components/share/share-control";
import { cafeFacts, formatDistanceKm } from "@/lib/discovery/view-model";
import { cafeCanonicalPath } from "@/lib/seo";
import { recordNavigationTap } from "@/lib/navigations";
import { displayCityName } from "@/lib/cities";
import { isOpenAt } from "@/lib/hours";
import { getQueryStaleTimeMs } from "@/lib/client-env";
import { apiFetch, ApiError } from "@/lib/http";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { PublicCafeDetail } from "@/types/cafes";
import { CheckinFeed } from "./checkin-feed";
import { FeedNotFoundError } from "./use-checkin-feed";
import { FactsRow } from "./card-parts";
import { PolicyConsensus, ScorePair, WorkProfile } from "./scores";
import { DossierHero } from "./dossier-hero";
import { SectionLabel } from "./section-label";
import { CreatorLine } from "./creator-line";
import { InlineError } from "./inline-error";

async function fetchCafe(id: string): Promise<PublicCafeDetail> {
  try {
    const cafe = await apiFetch<PublicCafeDetail>(`/api/cafes/${id}`);
    if (!cafe) throw new ApiError({ status: 500, code: "internal_error" });
    return cafe;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) throw new FeedNotFoundError();
    throw cause;
  }
}

/** §4 action row: Check in (primary), Navigate (outline), Share (ghost icon). */
function ActionRow({ cafe, onCheckIn }: { cafe: PublicCafeDetail; onCheckIn: (cafeId?: string, cafeName?: string) => void }) {
  const t = useTranslations("discovery");
  return (
    <div className="flex items-center gap-2">
      <Button variant="primary" className="flex-1 rounded-sm" onPress={() => onCheckIn(cafe.id, cafe.name)}>
        {t("check_in")}
      </Button>
      <Button
        variant="outline"
        className="min-w-24"
        onPress={() => {
          // The recorded row is what the return-visit prompt queue serves
          // on a later day (DG78); fire-and-forget — never block the link.
          recordNavigationTap(cafe.id);
          window.open(
            `https://www.google.com/maps/dir/?api=1&destination=${cafe.lat},${cafe.lng}`,
            "_blank",
            "noopener,noreferrer",
          );
        }}
      >
        {t("navigate")}
      </Button>
      <ShareControl
        url={`${window.location.origin}${cafeCanonicalPath(cafe.id)}`}
        title={cafe.name}
      />
    </div>
  );
}

/** Top-facts chips (HALF): up to 3, same priority order as PEEK. */
function FactChips({ cafe }: { cafe: PublicCafeDetail }) {
  const facts = cafeFacts(cafe, 3);
  if (facts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {facts.map((fact) => (
        <span
          key={fact.kind}
          className="rounded-sm border border-separator bg-surface-secondary px-2.5 py-1 text-xs text-foreground"
        >
          <FactsRow facts={[fact]} />
        </span>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="aspect-video w-full animate-pulse rounded-md bg-surface-tertiary" />
      <div className="flex flex-col gap-1.5">
        <div className="h-7 w-40 animate-pulse rounded bg-surface-tertiary" />
        <div className="h-3 w-56 animate-pulse rounded bg-surface-tertiary" />
      </div>
      <div className="h-8 w-28 animate-pulse rounded bg-surface-tertiary" />
      <div className="h-11 w-full animate-pulse rounded-sm bg-surface-tertiary" />
    </div>
  );
}

/** FULL-variant column shell (§5.3): centered, content-max width. Shared by
 * the pending/error/loaded returns so the feed keeps one JSX position and
 * never remounts across detail states (BRAWUKA-646). */
function FullShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-col gap-6 px-4 pb-8">
      {children}
    </div>
  );
}

/** FULL-variant guard states (skeleton/error) render inside the column shell
 * with the feed below them; HALF renders the node bare — it has no feed.
 * Keeping the feed mounted in one JSX position across detail states is what
 * lets its query run in parallel without a remount refetch (BRAWUKA-646). */
function withFeed(variant: "half" | "full", feed: ReactNode, node: ReactNode): ReactNode {
  if (variant !== "full") return node;
  return (
    <FullShell>
      {node}
      {feed}
    </FullShell>
  );
}

export function DetailContent({
  cafeId,
  variant,
  controller,
  onCheckIn,
  onClose,
  distanceM,
}: {
  cafeId: string;
  variant: "half" | "full";
  controller: DiscoveryController;
  onCheckIn: (cafeId?: string, cafeName?: string) => void;
  /** Desktop only: ghost × at the top-right of the detail column. */
  onClose?: () => void;
  /** Meters from the query point — summaries carry it, the detail row does not. */
  distanceM?: number;
}) {
  const t = useTranslations("discovery");
  const locale = useLocale();
  const { detailHeadingRef, handleMissingCafe } = controller;
  // SSR-seeded detail (BRAWUKA-283 P2-3): `CafeDetailSeed` on the cafe page
  // fills ["cafe", id] with a fresh `updatedAt`, so mount serves it with no
  // fetch. The pin below uses the same env-driven default as the app client
  // (`getQueryStaleTimeMs`, BRAWUKA-250) so ops tuning stays in one place.
  const query = useQuery({
    queryKey: ["cafe", cafeId],
    queryFn: () => fetchCafe(cafeId),
    staleTime: getQueryStaleTimeMs(),
  });

  // DG19/18f: an in-app 404 clears the selection and toasts.
  useEffect(() => {
    if (query.error instanceof FeedNotFoundError) handleMissingCafe();
  }, [query.error, handleMissingCafe]);

  // BRAWUKA-646: the feed mounts alongside the detail query — parallel
  // requests, not a waterfall behind `query.data`. It stays mounted across
  // pending/error/loaded states (same JSX position) so the observer never
  // re-subscribes. `cafeName` only reaches the owned-check-in edit form;
  // the unknown_cafe fallback matches the discovery-home convention.
  const feed =
    variant === "full" ? (
      <CheckinFeed
        cafeId={cafeId}
        cafeName={query.data?.name ?? t("unknown_cafe")}
        onMissingCafe={handleMissingCafe}
        onCheckIn={onCheckIn}
      />
    ) : null;

  if (query.isPending) return withFeed(variant, feed, <DetailSkeleton />);
  if (query.isError || !query.data) {
    if (query.error instanceof FeedNotFoundError) return null;
    return withFeed(
      variant,
      feed,
      <InlineError message={t("detail_load_failed")} onRetry={() => query.refetch()} />,
    );
  }
  const cafe = query.data;
  const covers = cafe.gallery.map((g) => g.card).filter(Boolean); // BRAWUKA-307: cafe.cover already derives from the first gallery card
  const heading = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2
          ref={detailHeadingRef}
          tabIndex={-1}
          className={`font-display font-bold tracking-tight text-balance text-foreground outline-none ${
            variant === "full" ? "text-2xl" : "text-xl"
          }`}
        >
          {cafe.name}
        </h2>
        {/* DG147: a private detail can only be the owner's — the read path
            404s it for everyone else. */}
        {cafe.visibility === "private" && <PrivateBadge />}
      </div>
      {onClose && (
        <Button
          variant="ghost"
          isIconOnly
          aria-label={t("close")}
          className="-m-1 h-11 w-11 min-w-11 text-muted hover:text-foreground"
          onPress={onClose}
        >
          <CloseIcon size={16} />
        </Button>
      )}
    </div>
  );

  const km = formatDistanceKm(distanceM);
  const openState = isOpenAt(cafe.opening_hours, cafe.tz);
  const metaParts: ReactNode[] = [];
  if (cafe.city) metaParts.push(displayCityName(cafe.city, locale));
  if (variant === "full" && cafe.address) metaParts.push(cafe.address);
  if (km !== null) metaParts.push(t("km_away", { km }));
  if (openState !== null) metaParts.push(<OpenState key="open" cafe={cafe} />);
  const meta = (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
      {metaParts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden>·</span>}
          {typeof part === "string" ? <span>{part}</span> : part}
        </Fragment>
      ))}
    </p>
  );

  if (variant === "half") {
    return (
      // pb clears the home indicator: the adaptive HALF detent (BRAWUKA-248)
      // hugs this column, so its bottom edge is the screen edge.
      <div className="flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DossierHero covers={covers} name={cafe.name} />
        <div className="flex flex-col gap-1">
          {heading}
          {meta}
        </div>
        <ScorePair stats={cafe.work_stats} />
        <ActionRow cafe={cafe} onCheckIn={onCheckIn} />
        <FactChips cafe={cafe} />
      </div>
    );
  }

  return (
    <FullShell>
      <DossierHero covers={covers} name={cafe.name} />
      <div className="flex flex-col gap-1.5">
        {heading}
        {meta}
        <CreatorLine author={cafe.author} maintainedByService={cafe.maintained_by_service} />
      </div>
      <ScorePair stats={cafe.work_stats} />
      <ActionRow cafe={cafe} onCheckIn={onCheckIn} />
      <WorkProfile stats={cafe.work_stats} />
      <PolicyConsensus stats={cafe.work_stats} />
      {cafe.gallery.length > 0 && (
        <section aria-label={t("gallery_aria")} className="flex flex-col gap-3">
          <SectionLabel>{t("gallery_aria")}</SectionLabel>
          <GalleryStrip photos={cafe.gallery} ariaLabel={t("gallery_aria")} />
        </section>
      )}
      {feed}
      {/* DG146/DG147: quiet "Manage" section at the bottom of the scroll —
          same controls as the SSR page, gated on the server ownership bit. */}
      {cafe.owned_by_viewer && (
        <CafeOwnerControls
          cafeId={cafe.id}
          initialVisibility={cafe.visibility ?? "public"}
          hasCheckins={(cafe.work_stats?.n_checkins ?? 0) > 0}
        />
      )}
    </FullShell>
  );
}
