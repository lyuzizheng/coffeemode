"use client";

/**
 * Check-in feed (artifact §5.3.5 + §6, spec 0001, DG11/DG17/DG72/DG113).
 *
 * List shell only: mode tabs, skeletons, empty/error states, card list, and
 * the paging sentinel. Data orchestration lives in `use-checkin-feed.ts`,
 * cards live in `feed-card.tsx`.
 *
 * Newest is the default mode (DG113). Switching modes keeps the previous
 * content until the new page arrives (stale-while-revalidate, DG17 — no
 * spinners on switch). Pagination is cursor-based and deduplicated by
 * check-in id.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { useSprings } from "@/lib/motion";
import type { CheckInFeedMode } from "@/types/checkins";
import { FeedCard } from "./feed-card";
import { InlineError } from "./inline-error";
import { FeedCursorExpiredError, FeedNotFoundError, useCheckinFeed } from "./use-checkin-feed";
import { SectionLabel } from "./section-label";

const MODES: CheckInFeedMode[] = ["helpful", "newest"];

// Helpful/Newest segmented control (role=tablist, arrow keys,
// snappy-spring pill slide).
function FeedModeTabs({
  mode,
  onChange,
}: {
  mode: CheckInFeedMode;
  onChange: (mode: CheckInFeedMode) => void;
}) {
  const t = useTranslations("discovery");
  const reduced = useReducedMotion();
  const springs = useSprings();
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = MODES.indexOf(mode);
    onChange(MODES[(i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length]);
  };
  return (
    <div
      role="tablist"
      aria-label={t("feed_mode_aria")}
      onKeyDown={onKeyDown}
      className="flex h-8 items-center rounded-md bg-surface-secondary p-0.5"
    >
      {MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(m)}
            className={`relative -my-2 flex min-h-11 items-center rounded-sm px-2.5 text-sm ${
              active ? "text-foreground" : "text-muted"
            }`}
          >
            {active && (
              <motion.span
                layoutId="feed-mode-pill"
                transition={reduced ? { duration: 0 } : springs.snappy}
                className="absolute inset-x-0 inset-y-2 rounded-sm border border-separator bg-surface"
                aria-hidden
              />
            )}
            <span className="relative">{t(`feed_modes.${m}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Skeleton cards mirror FeedCard geometry (spec 0002 skeleton rule,
 *  seo-sharing-v1 §2: 4 cards) — meta line, chip row, note lines, an
 *  optional photo strip, and the 44px action row. `photos`/`noteWidth`
 *  vary per card so the placeholder reads like a mixed feed, not a
 *  stamped-out grid. */
const SKELETON_CARDS: { photos: number; noteWidth: string }[] = [
  { photos: 3, noteWidth: "w-full" },
  { photos: 0, noteWidth: "w-2/3" },
  { photos: 2, noteWidth: "w-5/6" },
  { photos: 0, noteWidth: "w-1/2" },
];

function FeedSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden>
      {SKELETON_CARDS.map((shape, i) => (
        <div
          key={i}
          data-slot="feed-skeleton-card"
          className="flex flex-col gap-2 border-b border-separator py-4 first:pt-0 last:border-b-0"
        >
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 animate-pulse rounded-full bg-surface-tertiary" />
            <div className="h-3.5 w-32 animate-pulse rounded bg-surface-tertiary" />
          </div>
          <div className="flex gap-2">
            <div className="h-3 w-14 animate-pulse rounded bg-surface-tertiary" />
            <div className="h-3 w-14 animate-pulse rounded bg-surface-tertiary" />
          </div>
          <div className={`h-4 animate-pulse rounded bg-surface-tertiary ${shape.noteWidth}`} />
          {shape.photos > 0 && (
            <div className="flex gap-2">
              {Array.from({ length: shape.photos }, (_, p) => (
                <div
                  key={p}
                  className="h-[var(--layout-thumb)] w-[var(--layout-thumb)] animate-pulse rounded-md bg-surface-tertiary"
                />
              ))}
            </div>
          )}
          <div className="flex min-h-11 items-center">
            <div className="h-3 w-10 animate-pulse rounded bg-surface-tertiary" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedEmpty({ onCheckIn }: { onCheckIn: () => void }) {
  const t = useTranslations("discovery");
  return (
    <p className="text-sm text-muted">
      {t("empty_feed")}{" "}
      <button type="button" onClick={onCheckIn} className="text-accent underline-offset-2 hover:underline">
        {t("be_first")}
      </button>
    </p>
  );
}

export function CheckinFeed({
  cafeId,
  cafeName,
  onMissingCafe,
  onCheckIn,
}: {
  cafeId: string;
  cafeName: string;
  onMissingCafe: () => void;
  onCheckIn: () => void;
}) {
  const t = useTranslations("discovery");
  const [mode, setMode] = useState<CheckInFeedMode>("newest"); // DG113
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { query, checkins, like, likePendingIds, retryFromFirstPage } = useCheckinFeed(cafeId, mode);

  // 410 → the hook is already resetting; render the reset state, never an error frame (BRAWUKA-462).
  const cursorExpired = query.error instanceof FeedCursorExpiredError;

  // A 404 from the feed means the cafe is gone — route to the DG19 flow.
  useEffect(() => {
    if (query.error instanceof FeedNotFoundError) onMissingCafe();
  }, [query.error, onMissingCafe]);

  // Auto-load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [query]);

  return (
    <section aria-label={t("feed_title")}>
      <div className="mb-3">
        <SectionLabel action={<FeedModeTabs mode={mode} onChange={setMode} />}>
          {t("feed_title")}
        </SectionLabel>
      </div>

      {query.isPending || cursorExpired ? (
        <FeedSkeleton />
      ) : query.isError && checkins.length === 0 ? (
        query.error instanceof FeedNotFoundError ? null : (
          <InlineError message={t("load_failed")} onRetry={() => retryFromFirstPage()} />
        )
      ) : checkins.length === 0 ? (
        <FeedEmpty onCheckIn={onCheckIn} />
      ) : (
        <div className="flex flex-col">
          {checkins.map((checkin) => (
            <FeedCard
              key={checkin.id}
              checkin={checkin}
              cafeId={cafeId}
              cafeName={cafeName}
              onLike={like}
              likePending={likePendingIds.has(checkin.id)}
            />
          ))}
          {query.isFetchingNextPage && (
            <div className="h-10 animate-pulse rounded-md bg-surface-secondary" aria-hidden />
          )}
          {query.isError && (
            <InlineError message={t("load_failed")} onRetry={() => retryFromFirstPage()} />
          )}
          <div ref={sentinelRef} className="h-px" aria-hidden />
        </div>
      )}
    </section>
  );
}
