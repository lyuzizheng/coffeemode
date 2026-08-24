"use client";

/**
 * Cafe detail composition — HALF (artifact §5.2) and FULL (§5.3). The same
 * FULL content renders inside the mobile sheet and the desktop detail
 * column (DG42). Selection focuses the detail heading (DG18).
 */
import { Fragment, useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { CloseIcon } from "@/components/icons";
import { CoverCarousel } from "@/components/cafe/cover-carousel";
import { GalleryStrip } from "@/components/cafe/gallery-strip";
import { OpenState } from "@/components/cafe/open-state";
import { ShareControl } from "@/components/share/share-control";
import { cafeFacts, formatDistanceKm } from "@/lib/discovery/view-model";
import { cafeCanonicalPath } from "@/lib/seo";
import { isOpenAt } from "@/lib/hours";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeDetail } from "@/types/cafes";
import { CheckinFeed, FeedNotFoundError } from "./checkin-feed";
import { FactsRow } from "./cafe-card";
import { InlineError } from "./inline-error";
import { PolicyConsensus, ScorePair, WorkProfile } from "./scores";

async function fetchCafe(id: string): Promise<CafeDetail> {
  const res = await fetch(`/api/cafes/${id}`);
  if (res.status === 404) throw new FeedNotFoundError();
  if (!res.ok) throw new Error(`cafe failed: ${res.status}`);
  return (await res.json()) as CafeDetail;
}

/** §4 action row: Check in (primary), Navigate (outline), Share (ghost icon). */
function ActionRow({ cafe, onCheckIn }: { cafe: CafeDetail; onCheckIn: () => void }) {
  const t = useTranslations("discovery");
  return (
    <div className="flex items-center gap-2">
      <Button variant="primary" className="flex-1 rounded-sm" onPress={onCheckIn}>
        {t("check_in")}
      </Button>
      <Button
        variant="outline"
        className="min-w-24"
        onPress={() =>
          window.open(
            `https://www.google.com/maps/dir/?api=1&destination=${cafe.lat},${cafe.lng}`,
            "_blank",
            "noopener,noreferrer",
          )
        }
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
function FactChips({ cafe }: { cafe: CafeDetail }) {
  const facts = cafeFacts(cafe, 3);
  if (facts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {facts.map((fact) => (
        <span
          key={fact.kind}
          className="rounded-sm bg-surface-secondary px-2.5 py-1.5 text-xs text-foreground"
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
      <div className="h-4 w-40 animate-pulse rounded bg-surface-tertiary" />
      <div className="h-3 w-56 animate-pulse rounded bg-surface-tertiary" />
    </div>
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
  onCheckIn: () => void;
  /** Desktop only: ghost × at the top-right of the detail column. */
  onClose?: () => void;
  /** Meters from the query point — summaries carry it, the detail row does not. */
  distanceM?: number;
}) {
  const t = useTranslations("discovery");
  const { detailHeadingRef, handleMissingCafe } = controller;
  const query = useQuery({
    queryKey: ["cafe", cafeId],
    queryFn: () => fetchCafe(cafeId),
  });

  // DG19/18f: an in-app 404 clears the selection and toasts.
  useEffect(() => {
    if (query.error instanceof FeedNotFoundError) handleMissingCafe();
  }, [query.error, handleMissingCafe]);

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    if (query.error instanceof FeedNotFoundError) return null;
    return <InlineError message={t("detail_load_failed")} onRetry={() => query.refetch()} />;
  }
  const cafe = query.data;
  const covers = cafe.gallery.map((g) => g.card).filter(Boolean);
  if (covers.length === 0 && cafe.cover) covers.push(cafe.cover);

  const heading = (
    <div className="flex items-start justify-between gap-2">
      <h2
        ref={detailHeadingRef}
        tabIndex={-1}
        className={`font-display font-bold tracking-tight text-foreground outline-none ${
          variant === "full" ? "text-xl" : "text-lg"
        }`}
      >
        {cafe.name}
      </h2>
      {onClose && (
        <Button
          variant="ghost"
          isIconOnly
          aria-label={t("close")}
          className="h-9 w-9 min-w-9 text-muted hover:text-foreground"
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
  if (cafe.city) metaParts.push(cafe.city);
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
      <div className="flex flex-col gap-3 px-4">
        <CoverCarousel images={covers} alt={cafe.name} />
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
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 pb-8">
      <div className="flex flex-col gap-1.5">
        {heading}
        {meta}
      </div>
      <ScorePair stats={cafe.work_stats} />
      <ActionRow cafe={cafe} onCheckIn={onCheckIn} />
      <WorkProfile stats={cafe.work_stats} />
      <PolicyConsensus stats={cafe.work_stats} />
      <GalleryStrip photos={cafe.gallery} ariaLabel={t("gallery_aria")} />
      <CheckinFeed
        cafeId={cafe.id}
        onMissingCafe={handleMissingCafe}
        onCheckIn={onCheckIn}
      />
    </div>
  );
}
