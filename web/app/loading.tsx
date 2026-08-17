"use client";

import { Skeleton } from "@heroui/react";

/**
 * Instant-loading fallback for `/` (the only dynamic route today): a skeleton
 * of the home layout — header, hero, three steps, sign-in card. Skeleton
 * shimmer, never a spinner (spec 0002).
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-10 w-36" />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-3 h-9 w-3/4" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />

          <div className="mt-10 space-y-5 border-t border-separator pt-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="mt-0.5 h-4 w-6 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>

          <Skeleton className="mt-10 h-44 w-full rounded-md" />
        </div>
      </main>
    </div>
  );
}
