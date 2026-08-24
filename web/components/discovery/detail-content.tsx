"use client";

/**
 * Cafe detail composition — HALF (artifact §5.2) and FULL (§5.3). The same
 * FULL content renders inside the mobile sheet and the desktop detail
 * column (DG42). Selection focuses the detail heading (DG18).
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button, toast } from "@heroui/react";
import { CloseIcon, ShareIcon } from "@/components/icons";
import { cafeFacts, formatDistanceKm } from "@/lib/discovery/view-model";
import { closingTimeToday, isOpenAt } from "@/lib/hours";
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

/** Open-state meta: success dot + "Open until 22:00", danger dot + "Closed". */
function OpenState({ cafe }: { cafe: Pick<CafeDetail, "opening_hours" | "tz"> }) {
  const t = useTranslations("discovery");
  const open = isOpenAt(cafe.opening_hours, cafe.tz);
  if (open === null) return null; // unknown hours render nothing, never a guess
  const close = open ? closingTimeToday(cafe.opening_hours, cafe.tz) : null;
  return (
    <span className={`flex items-center gap-1 ${open ? "text-success" : "text-danger"}`}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {open
        ? close
          ? t("open_until", { time: close })
          : t("open_now")
        : t("closed")}
    </span>
  );
}

/** 16:9 cover carousel with page dots; omitted entirely when no photos. */
function CoverCarousel({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  if (images.length === 0) return null;
  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-md md:max-h-[360px]"
      >
        {images.map((src, i) => (
          <div
            key={src}
            className="relative aspect-video w-full shrink-0 snap-center overflow-hidden rounded-md border border-separator bg-surface-tertiary"
          >
            <Image
              src={src}
              alt={i === 0 ? alt : ""}
              fill
              sizes="(min-width: 1024px) 400px, 100vw"
              className="object-cover"
              priority={i === 0}
            />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
          {images.map((src, i) => (
            <span
              key={src}
              className={`h-[3px] w-[3px] rounded-full ${i === active ? "bg-accent" : "bg-separator"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** §4 action row: Check in (primary), Navigate (outline), Share (ghost icon). */
function ActionRow({ cafe, onCheckIn }: { cafe: CafeDetail; onCheckIn: () => void }) {
  const t = useTranslations("discovery");
  const share = async () => {
    const url = `${window.location.origin}/cafes/${cafe.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t("share_copied"), { timeout: 4000 });
    } catch {
      toast(t("share_failed"), { timeout: 4000 });
    }
  };
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
      <Button
        variant="ghost"
        isIconOnly
        aria-label={t("share")}
        className="h-9 w-9 min-w-9 text-muted hover:text-foreground"
        onPress={share}
      >
        <ShareIcon size={16} />
      </Button>
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
      {cafe.gallery.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" aria-label={t("gallery_aria")}>
          {cafe.gallery.map((photo) => (
            <span
              key={photo.id}
              className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-separator bg-surface-tertiary"
            >
              <Image src={photo.thumbnail} alt="" fill sizes="72px" className="object-cover" />
            </span>
          ))}
        </div>
      )}
      <CheckinFeed
        cafeId={cafe.id}
        onMissingCafe={handleMissingCafe}
        onCheckIn={onCheckIn}
      />
    </div>
  );
}
