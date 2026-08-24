"use client";

/**
 * Check-in feed (artifact §5.3.5 + §6, spec 0001, DG11/DG17/DG113).
 *
 * Newest is the default mode (DG113). The Helpful/Newest control is one
 * segmented control (role=tablist, arrow keys, 120ms pill slide); switching
 * modes keeps the previous content until the new page arrives
 * (stale-while-revalidate, DG17 — no spinners on switch). Pagination is
 * cursor-based and deduplicated by check-in id.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "@heroui/react";
import { HeartIcon } from "@/components/icons";
import { InlineError } from "./inline-error";
import { dedupeCheckins } from "@/lib/discovery/view-model";
import { duration, ease } from "@/lib/motion";
import { WORK_DIMS, type WorkDim } from "@/lib/stats/work-stats";
import type { CheckInFeedMode, CheckInFeedPage, PublicCheckIn } from "@/types/checkins";

const MODES: CheckInFeedMode[] = ["helpful", "newest"];

async function fetchFeedPage(
  cafeId: string,
  mode: CheckInFeedMode,
  cursor?: string,
): Promise<CheckInFeedPage> {
  const params = new URLSearchParams({ mode });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/cafes/${cafeId}/checkins?${params}`);
  if (res.status === 404) throw new FeedNotFoundError();
  if (!res.ok) throw new Error(`feed failed: ${res.status}`);
  return (await res.json()) as CheckInFeedPage;
}

export class FeedNotFoundError extends Error {
  constructor() {
    super("cafe not found");
    this.name = "FeedNotFoundError";
  }
}

/** `A nomad · Mar 2026` — MVP identity is anonymous (DG13). */
function FeedCardMeta({ visitedAt }: { visitedAt: string }) {
  const t = useTranslations("discovery");
  const locale = useLocale();
  const date = new Date(visitedAt);
  const label = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(date);
  return (
    <p className="text-sm text-foreground">
      {t("a_nomad")}
      {label && <span className="text-muted"> · {label}</span>}
    </p>
  );
}

/** Dimension mini-scores as text chips: `wifi 87 · coffee 81` (text-xs muted tabular). */
function MiniScores({ checkin }: { checkin: PublicCheckIn }) {
  const t = useTranslations("discovery");
  const chips = WORK_DIMS.filter((dim: WorkDim) => typeof checkin.scores[dim] === "number");
  if (chips.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
      {chips.map((dim) => (
        <span key={dim} className="tnum whitespace-nowrap">
          {t(`dims.${dim}`)} {Math.round(checkin.scores[dim] ?? 0)}
        </span>
      ))}
    </p>
  );
}

function FeedCard({
  checkin,
  onLike,
  likePending,
}: {
  checkin: PublicCheckIn;
  onLike: (checkin: PublicCheckIn) => void;
  likePending: boolean;
}) {
  const t = useTranslations("discovery");
  const liked = checkin.liked_by_viewer;
  return (
    <article className="flex flex-col gap-2 rounded-md border border-separator bg-surface p-3">
      <FeedCardMeta visitedAt={checkin.visited_at} />
      <MiniScores checkin={checkin} />
      {checkin.note && <p className="text-base text-foreground">{checkin.note}</p>}
      {checkin.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {checkin.photos.map((photo) => (
            <span
              key={photo.id}
              className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-separator bg-surface-tertiary"
            >
              <Image
                src={photo.thumbnail}
                alt=""
                fill
                sizes="72px"
                className="object-cover"
              />
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={liked}
          aria-label={t("like_aria")}
          disabled={likePending}
          onClick={() => onLike(checkin)}
          className={`flex min-h-11 min-w-11 -translate-x-2.5 items-center gap-1 rounded-sm px-2.5 text-xs ${
            liked ? "text-danger" : "text-muted"
          } transition-colors hover:text-foreground`}
        >
          <HeartIcon size={14} filled={liked} />
          <span className="tnum">{checkin.likes_count}</span>
        </button>
      </div>
    </article>
  );
}

export function CheckinFeed({
  cafeId,
  onMissingCafe,
  onCheckIn,
}: {
  cafeId: string;
  onMissingCafe: () => void;
  onCheckIn: () => void;
}) {
  const t = useTranslations("discovery");
  const [mode, setMode] = useState<CheckInFeedMode>("newest"); // DG113
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["cafe-checkins", cafeId, mode],
    queryFn: ({ pageParam }) => fetchFeedPage(cafeId, mode, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // DG17: previous mode's content stays until the new page arrives.
    placeholderData: keepPreviousData,
  });

  // A 404 from the feed means the cafe is gone — route to the DG19 flow.
  useEffect(() => {
    if (query.error instanceof FeedNotFoundError) onMissingCafe();
  }, [query.error, onMissingCafe]);

  const checkins = useMemo(
    () => (query.data ? dedupeCheckins(query.data.pages) : []),
    [query.data],
  );

  const likeMutation = useMutation({
    mutationFn: async (checkin: PublicCheckIn) => {
      const res = await fetch(`/api/checkins/${checkin.id}/like`, { method: "POST" });
      if (res.status === 401) throw new LikeAuthError();
      if (!res.ok) throw new Error(`like failed: ${res.status}`);
      return (await res.json()) as { liked: boolean; likesCount: number };
    },
    onMutate: async (checkin) => {
      // Optimistic toggle across every cached mode of this cafe's feed.
      const key = ["cafe-checkins", cafeId];
      await queryClient.cancelQueries({ queryKey: key });
      const snapshots = queryClient.getQueriesData<InfiniteData<CheckInFeedPage>>({
        queryKey: key,
      });
      const delta = checkin.liked_by_viewer ? -1 : 1;
      queryClient.setQueriesData<InfiniteData<CheckInFeedPage>>({ queryKey: key }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            checkins: page.checkins.map((c) =>
              c.id === checkin.id
                ? {
                    ...c,
                    liked_by_viewer: !c.liked_by_viewer,
                    likes_count: Math.max(0, c.likes_count + delta),
                  }
                : c,
            ),
          })),
        };
      });
      return { snapshots };
    },
    onError: (err, _checkin, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (err instanceof LikeAuthError) {
        toast(t("like_signin"), { timeout: 4000 });
      } else {
        toast(t("load_failed"), { timeout: 4000 });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
    },
  });

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

  const switchMode = (next: CheckInFeedMode) => setMode(next);
  const onModeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = MODES.indexOf(mode);
    const next = MODES[(i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length];
    switchMode(next);
  };

  return (
    <section aria-label={t("feed_title")}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold text-foreground">{t("feed_title")}</h3>
        <div
          role="tablist"
          aria-label={t("feed_mode_aria")}
          onKeyDown={onModeKeyDown}
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
                onClick={() => switchMode(m)}
                className={`relative h-full rounded-sm px-2.5 text-sm ${
                  active ? "text-foreground" : "text-muted"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="feed-mode-pill"
                    transition={{ duration: duration.feedback, ease: ease.default }}
                    className="absolute inset-0 rounded-sm border border-separator bg-surface"
                    aria-hidden
                  />
                )}
                <span className="relative">{t(`feed_modes.${m}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {query.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="rounded-md border border-separator bg-surface p-3">
              <div className="mb-2 h-3.5 w-24 animate-pulse rounded bg-surface-tertiary" />
              <div className="h-3 w-40 animate-pulse rounded bg-surface-tertiary" />
            </div>
          ))}
        </div>
      ) : query.isError && checkins.length === 0 ? (
        query.error instanceof FeedNotFoundError ? null : (
          <InlineError message={t("load_failed")} onRetry={() => query.refetch()} />
        )
      ) : checkins.length === 0 ? (
        <p className="text-sm text-muted">
          {t("empty_feed")}{" "}
          <button type="button" onClick={onCheckIn} className="text-accent underline-offset-2 hover:underline">
            {t("be_first")}
          </button>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {checkins.map((checkin) => (
            <FeedCard
              key={checkin.id}
              checkin={checkin}
              onLike={(c) => likeMutation.mutate(c)}
              likePending={likeMutation.isPending}
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

class LikeAuthError extends Error {
  constructor() {
    super("like requires sign-in");
    this.name = "LikeAuthError";
  }
}
