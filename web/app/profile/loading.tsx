"use client";

import { Skeleton } from "@heroui/react";

/**
 * Instant loading fallback for /profile (spec 0002 / profile-page-v1 §5).
 * Hero circle + two stat blocks + tab bar + 4 card placeholders with shimmer.
 */
export default function ProfileLoading() {
  return (
    <div aria-busy="true" className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6 sm:px-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Hero section */}
      <div className="mt-8 flex flex-col items-center">
        {/* Avatar circle */}
        <Skeleton className="h-20 w-20 rounded-full" />
        {/* Name and city */}
        <Skeleton className="mt-4 h-6 w-36" />
        <Skeleton className="mt-2 h-4 w-24" />

        {/* Two stat blocks */}
        <div className="mt-6 flex w-full max-w-xs items-center justify-center gap-8 border-y border-separator py-4">
          <div className="flex flex-col items-center gap-1">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="h-8 w-px bg-separator" />
          <div className="flex flex-col items-center gap-1">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>

      {/* Tab bar skeleton */}
      <div className="mt-8 flex gap-2 border-b border-separator pb-2">
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      {/* 4 Card skeletons */}
      <div className="mt-6 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-separator/60 p-4"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
