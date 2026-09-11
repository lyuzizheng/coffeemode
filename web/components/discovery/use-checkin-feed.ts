/**
 * Check-in feed data orchestration (spec 0001, DG11/DG17).
 *
 * Owns the cursor-paginated infinite query plus the like mutation with
 * optimistic convergence: the optimistic toggle spans every cached mode of
 * this cafe's feed, rolls back from snapshots on error, and revalidates on
 * settle. Render stays in `checkin-feed.tsx`; cards stay in `feed-card.tsx`.
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
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
  if (!res.ok) throw new Error(`feed failed: ${res.status}`);
  return (await res.json()) as CheckInFeedPage;
}

export class FeedNotFoundError extends Error {
  constructor() {
    super("cafe not found");
    this.name = "FeedNotFoundError";
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

  const query = useInfiniteQuery({
    queryKey: ["cafe-checkins", cafeId, mode],
    queryFn: ({ pageParam }) => fetchFeedPage(cafeId, mode, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // DG17: previous mode's content stays until the new page arrives.
    placeholderData: keepPreviousData,
  });

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

  return {
    query,
    checkins,
    like: (checkin: PublicCheckIn) => likeMutation.mutate(checkin),
    likePending: likeMutation.isPending,
  };
}
