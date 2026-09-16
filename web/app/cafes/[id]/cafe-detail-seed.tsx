"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicCafeDetail } from "@/types/cafes";

/**
 * Seeds the SSR-rendered cafe detail into the client query cache
 * (BRAWUKA-283 P2-3). The page shell already rendered this payload
 * server-side; without the seed, mounting `DetailContent` (same
 * `["cafe", id]` key) would re-fetch `GET /api/cafes/[id]` on first open.
 * The explicit `updatedAt` marks the seed fresh under the 5min staleTime,
 * so mount serves it with no fetch; background revalidation still applies
 * once it goes stale.
 */
export function CafeDetailSeed({ cafe }: { cafe: PublicCafeDetail }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.setQueryData(["cafe", cafe.id], cafe, { updatedAt: Date.now() });
  }, [queryClient, cafe]);
  return null;
}
