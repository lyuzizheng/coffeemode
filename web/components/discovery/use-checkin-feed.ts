/**
 * Check-in feed data orchestration (spec 0001, DG11/DG17).
 *
 * Owns the cursor-paginated infinite query plus the like mutation with
 * optimistic convergence: the optimistic toggle spans every cached mode of
 * this cafe's feed, rolls back from snapshots on error, and revalidates on
 * settle. Render stays in `checkin-feed.tsx`; cards stay in `feed-card.tsx`.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "@heroui/react";
import { apiErrorMessage, apiFetch, ApiError, isUnauthorized } from "@/lib/http";
import { shouldRetryQuery } from "@/lib/query/retry";
import { dedupeCheckins } from "@/lib/discovery/view-model";
import type { CheckInFeedMode, CheckInFeedPage, PublicCheckIn } from "@/types/checkins";

async function fetchFeedPage(
  cafeId: string,
  mode: CheckInFeedMode,
  cursor?: string,
): Promise<CheckInFeedPage> {
  const params = new URLSearchParams({ mode });
  if (cursor) params.set("cursor", cursor);
  try {
    const page = await apiFetch<CheckInFeedPage>(`/api/cafes/${cafeId}/checkins?${params}`);
    if (!page) throw new ApiError({ status: 500, code: "internal_error" });
    return page;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) throw new FeedNotFoundError();
    if (cause instanceof ApiError && cause.status === 410) throw new FeedCursorExpiredError();
    throw cause;
  }
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

  const likeMutation = useLikeMutation(queryClient, cafeId, t("like_signin"), t("like_failed"));
  const mutateLike = likeMutation.mutate;
  // Stable identity so FeedCard's memo (BRAWUKA-647) holds — cards re-render
  // only when their own props change (BRAWUKA-281 P2). `mutate` is stable
  // across renders; depending on the whole mutation object would defeat that.
  const like = useCallback(
    (checkin: PublicCheckIn) => mutateLike(checkin),
    [mutateLike],
  );
  // Per-card pending: every in-flight like disables only its own card's
  // button. `mutation.variables` only names the latest mutation, so pending
  // ids come from the mutation cache keyed by check-in id (BRAWUKA-460).
  const pendingLikes = useMutationState({
    filters: { mutationKey: ["like-checkin", cafeId], status: "pending" },
    select: (mutation) => (mutation.state.variables as PublicCheckIn).id,
  });
  const likePendingIds = useMemo(() => new Set(pendingLikes), [pendingLikes]);

  return {
    query,
    checkins,
    like,
    likePendingIds,
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
    // Everything else defers to the shared policy (offline gate + 4xx
    // discrimination, spec 0011 D9).
    retry: (failureCount, error) =>
      error instanceof FeedCursorExpiredError || error instanceof FeedNotFoundError
        ? false
        : shouldRetryQuery(
            failureCount,
            error,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
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

/** Apply `delta` to one check-in's optimistic like fields across every
 * cached mode of this cafe's feed (BRAWUKA-460: keyed per check-in so a
 * sibling card's pending like is untouched). */
function shiftOptimisticLike(
  queryClient: QueryClient,
  cafeId: string,
  checkin: PublicCheckIn,
  delta: 1 | -1,
) {
  queryClient.setQueriesData<InfiniteData<CheckInFeedPage>>(
    { queryKey: ["cafe-checkins", cafeId] },
    (data) => {
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
    },
  );
}

function useLikeMutation(queryClient: QueryClient, cafeId: string, signInCopy: string, failedCopy: string) {
  const tApi = useTranslations();
  // In-flight like count. `onSettled` runs before the mutation's status
  // dispatch, so `isMutating` cannot tell the last settle from an earlier
  // one — count manually and refetch only once every like has settled.
  const inFlight = useRef(0);
  return useMutation({
    mutationKey: ["like-checkin", cafeId],
    mutationFn: async (checkin: PublicCheckIn) => {
      return apiFetch<{ liked: boolean; likes_count: number }>(
        `/api/checkins/${checkin.id}/like`,
        { method: "POST" },
      );
    },
    onMutate: async (checkin) => {
      inFlight.current += 1;
      // Optimistic toggle across every cached mode of this cafe's feed.
      await queryClient.cancelQueries({ queryKey: ["cafe-checkins", cafeId] });
      shiftOptimisticLike(queryClient, cafeId, checkin, checkin.liked_by_viewer ? -1 : 1);
    },
    onError: (err, checkin) => {
      // Roll back only this check-in's optimistic fields. Restoring whole
      // snapshots would also revert a sibling card's still-pending
      // optimistic like (BRAWUKA-460).
      shiftOptimisticLike(queryClient, cafeId, checkin, checkin.liked_by_viewer ? 1 : -1);
      if (isUnauthorized(err)) {
        toast(signInCopy, { timeout: 4000 });
      } else {
        // Code-driven copy: `self_like_forbidden` resolves to its own
        // message via the apiFetch mapper; anything else is the like
        // fallback (never the feed's load_failed).
        toast(apiErrorMessage(err, failedCopy, tApi), { timeout: 4000 });
      }
    },
    onSettled: () => {
      // A refetch landing while a sibling like is still in flight would
      // overwrite its optimistic state with pre-like server data — wait
      // for the last settle, then invalidate once.
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
      }
    },
  });
}
