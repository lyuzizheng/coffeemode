"use client";

import { Skeleton } from "@heroui/react";

/**
 * Instant loading fallback for /profile (spec 0002 / profile-page-v2 §5).
 * Mirrors the real layout: header row, hero (avatar + name + city chip),
 * stat strip, segmented tab bar, then list cards — same geometry as
 * ProfileView so the swap never shifts layout.
 */
export default function ProfileLoading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex min-h-dvh w-full max-w-[var(--layout-content-max)] flex-col px-4 py-4 md:px-6"
    >
      {/* Header: back button · title · theme + sign-out */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-11 w-11 rounded-full" />
        <Skeleton className="h-6 w-16" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      </div>

      {/* Hero: avatar, name, city chip */}
      <div className="flex flex-col items-center pt-2 pb-6">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="mt-4 h-8 w-36" />
        <Skeleton className="mt-2 h-6 w-24 rounded-full" />
      </div>

      {/* Stat strip: two numerals over a hairline */}
      <div className="mx-auto my-4 flex w-full max-w-xs items-center justify-center gap-8 border-y border-separator py-4">
        <div className="flex flex-col items-center gap-1">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="h-8 w-px bg-separator" />
        <div className="flex flex-col items-center gap-1">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>

      {/* Segmented tab bar (rounded-md track, rounded-sm tabs) */}
      <div className="my-4 flex items-center gap-0.5 rounded-md bg-surface-secondary p-0.5">
        <Skeleton className="h-9 min-w-[90px] flex-1 rounded-sm" />
        <Skeleton className="h-9 min-w-[90px] flex-1 rounded-sm" />
        <Skeleton className="h-9 min-w-[90px] flex-1 rounded-sm" />
        <Skeleton className="h-9 min-w-[90px] flex-1 rounded-sm" />
      </div>

      {/* List cards — same p-3 rounded-md geometry as the real rows */}
      <div className="flex flex-col gap-3 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-md border border-separator/60 p-3"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-8 w-16 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
