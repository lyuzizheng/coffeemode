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
import { spring } from "@/lib/motion";
import type { CheckInFeedMode } from "@/types/checkins";
import { FeedCard } from "./feed-card";
import { InlineError } from "./inline-error";
import { FeedNotFoundError, useCheckinFeed } from "./use-checkin-feed";

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
      className="flex h-8 items-center rounded-sm bg-surface-secondary p-0.5"
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
            className={`relative h-full rounded-sm px-2.5 text-sm ${
              active ? "text-foreground" : "text-muted"
            }`}
          >
            {active && (
              <motion.span
                layoutId="feed-mode-pill"
                transition={reduced ? { duration: 0 } : spring.snappy}
                className="absolute inset-0 rounded-sm border border-separator bg-surface"
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

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-md border border-separator bg-surface p-3">
          <div className="mb-2 h-3.5 w-24 animate-pulse rounded bg-surface-tertiary" />
          <div className="h-3 w-40 animate-pulse rounded bg-surface-tertiary" />
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

  const { query, checkins, like, likePending } = useCheckinFeed(cafeId, mode);

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
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold text-foreground">{t("feed_title")}</h3>
        <FeedModeTabs mode={mode} onChange={setMode} />
      </div>

      {query.isPending ? (
        <FeedSkeleton />
      ) : query.isError && checkins.length === 0 ? (
        query.error instanceof FeedNotFoundError ? null : (
          <InlineError message={t("load_failed")} onRetry={() => query.refetch()} />
        )
      ) : checkins.length === 0 ? (
        <FeedEmpty onCheckIn={onCheckIn} />
      ) : (
        <div className="flex flex-col gap-2">
          {checkins.map((checkin) => (
            <FeedCard
              key={checkin.id}
              checkin={checkin}
              cafeId={cafeId}
              cafeName={cafeName}
              onLike={like}
              likePending={likePending}
            />
          ))}
          {query.isFetchingNextPage && (
            <div className="h-10 animate-pulse rounded-md bg-surface-secondary" aria-hidden />
          )}
          {query.isError && (
            <InlineError message={t("load_failed")} onRetry={() => query.fetchNextPage()} />
          )}
          <div ref={sentinelRef} className="h-px" aria-hidden />
        </div>
      )}
    </section>
  );
}
