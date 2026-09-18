/**
 * Check-in feed data orchestration (spec 0001, DG11/DG17).
 *
 * Owns the cursor-paginated infinite query plus the like mutation with
 * optimistic convergence: the optimistic toggle spans every cached mode of
 * this cafe's feed, rolls back from snapshots on error, and revalidates on
 * settle. Render stays in `checkin-feed.tsx`; cards stay in `feed-card.tsx`.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "@heroui/react";
import { dedupeCheckins } from "@/lib/discovery/view-model";
import type { CheckInFeedMode, CheckInFeedPage, PublicCheckIn } from "@/types/checkins";

async function fetchFeedPage(
  cafeId: string,
  mode: CheckInFeedMode,
  cursor?: string,
): Promise<CheckInFeedPage> {
  const params = new URLSearchParams({ mode });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/cafes/${cafeId}/checkins?${params}`);
  if (res.status === 404) throw new FeedNotFoundError();
  if (res.status === 410) throw new FeedCursorExpiredError();
  if (!res.ok) throw new Error(`feed failed: ${res.status}`);
  return (await res.json()) as CheckInFeedPage;
}

export class FeedNotFoundError extends Error {
  constructor() {
    super("cafe not found");
    this.name = "FeedNotFoundError";
  }
}

/**
 * The helpful snapshot rotated under a live cursor (410
 * `cursor_version_expired`). The stored cursor is dead — the only recovery
 * is discarding cached pages and restarting from page one (BRAWUKA-280).
 */
export class FeedCursorExpiredError extends Error {
  constructor() {
    super("feed cursor expired; restart from page one");
    this.name = "FeedCursorExpiredError";
  }
}

class LikeAuthError extends Error {
  constructor() {
    super("like requires sign-in");
    this.name = "LikeAuthError";
  }
}

/**
 * Paginated feed state for one cafe + mode, with optimistic like toggling.
 * Mode switching keeps the previous mode's content until the new page
 * arrives (stale-while-revalidate, DG17 — no spinners on switch).
 */
export function useCheckinFeed(cafeId: string, mode: CheckInFeedMode) {
  const t = useTranslations("discovery");
  const queryClient = useQueryClient();

  const query = useFeedQuery(queryClient, cafeId, mode);

  const checkins = useMemo(
    () => (query.data ? dedupeCheckins(query.data.pages) : []),
    [query.data],
  );

  const likeMutation = useLikeMutation(queryClient, cafeId, t("like_signin"), t("load_failed"));
  const mutateLike = likeMutation.mutate;

  // Stable identity so a memoized FeedCard does not re-render on every
  // parent render (BRAWUKA-281 P2). `mutate` is stable across renders;
  // depending on the whole mutation object would defeat the memo.
  const like = useCallback(
    (checkin: PublicCheckIn) => mutateLike(checkin),
    [mutateLike],
  );
  // Per-card pending: a like in flight disables only its own card's button.
  // `variables` is the check-in passed to `mutate`; null when idle.
  const likePendingId = likeMutation.isPending ? (likeMutation.variables?.id ?? null) : null;

  return {
    query,
    checkins,
    like,
    likePendingId,
    /**
     * Retry that never re-sends a dead cursor: clears cached pages (and
     * their page params) then refetches from page one. Plain `refetch()` or
     * `fetchNextPage()` would replay the expired cursor into another 410.
     */
    retryFromFirstPage: () => queryClient.resetQueries({ queryKey: ["cafe-checkins", cafeId, mode] }),
  };
}

function useFeedQuery(
  queryClient: QueryClient,
  cafeId: string,
  mode: CheckInFeedMode,
) {
  const query = useInfiniteQuery({
    queryKey: ["cafe-checkins", cafeId, mode],
    queryFn: ({ pageParam }) => fetchFeedPage(cafeId, mode, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // A 410 means the stored cursor is dead — never auto-retry it. A 404
    // means the cafe is gone: retrying can never succeed, so surface the
    // error immediately and let the DG19 gone-cafe flow run (BRAWUKA-450).
    retry: (failureCount, error) =>
      error instanceof FeedCursorExpiredError || error instanceof FeedNotFoundError
        ? false
        : failureCount < 2,
    // DG17: previous mode's content stays until the new page arrives.
    placeholderData: keepPreviousData,
  });

  // A 410 means the stored cursor is dead: retrying would just resend it.
  // Drop the cached pages so there is no dead cursor left to re-send, then
  // refetch from page one (BRAWUKA-280).
  const expired = query.error instanceof FeedCursorExpiredError;
  useEffect(() => {
    if (!expired) return;
    queryClient.resetQueries({ queryKey: ["cafe-checkins", cafeId, mode] });
  }, [expired, queryClient, cafeId, mode]);
  return query;
}
function useLikeMutation(queryClient: QueryClient, cafeId: string, signInCopy: string, failedCopy: string) {
  return useMutation({
    mutationFn: async (checkin: PublicCheckIn) => {
      const res = await fetch(`/api/checkins/${checkin.id}/like`, { method: "POST" });
      if (res.status === 401) throw new LikeAuthError();
      if (!res.ok) throw new Error(`like failed: ${res.status}`);
      return (await res.json()) as { liked: boolean; likes_count: number };
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
        toast(signInCopy, { timeout: 4000 });
      } else {
        toast(failedCopy, { timeout: 4000 });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
    },
  });
}
