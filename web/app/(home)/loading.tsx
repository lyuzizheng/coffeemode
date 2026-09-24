"use client";

import { Skeleton } from "@heroui/react";

/**
 * Instant-loading fallback for `/` (the map home): a skeleton of the real
 * shell — full-viewport map canvas, floating search capsule, account chip,
 * and the collapsed sheet bar at the bottom. Skeleton shimmer, never a
 * spinner (spec 0002).
 *
 * Scoped to `/` via the `(home)` route group (BRAWUKA-658): a ROOT-level
 * loading boundary streams a 200 shell before `generateMetadata` resolves,
 * which would demote every `/cafes/[id]` notFound() to a soft-404 (DG19).
 * Keep this file inside `(home)` — never move it back to `app/`.
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="relative min-h-dvh bg-surface-secondary">
      {/* Mobile: floating search capsule + account chip */}
      <div className="fixed inset-x-4 top-4 z-10 lg:hidden">
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
      <Skeleton className="fixed right-4 top-[var(--layout-chrome-offset)] z-10 h-14 w-28 rounded-full lg:right-[var(--layout-chrome-offset)] lg:top-6" />

      {/* Desktop: sidebar column — mirrors the scroll-top expanded state
          (BRAWUKA-506): invisible masthead slot, brand frontispiece
          (eyebrow, wordmark, manifesto, add-cafe CTA), then index
          skeletons. No search row — the SSR shell mounts it only after
          hydration (contentVisible), so the mirror stays exact. */}
      <div className="fixed inset-y-0 left-0 z-10 hidden w-[var(--layout-aside-column)] flex-col border-r border-separator bg-surface lg:flex">
        <div className="h-[var(--layout-masthead-h)]" />
        <div className="flex h-[min(46dvh,400px)] flex-col items-center justify-center gap-3 px-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-1 h-8 w-24 rounded-md" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 border-b border-separator px-4 py-3">
            <Skeleton className="h-[var(--layout-row-cover-h)] w-[var(--layout-row-cover-w)] rounded-sm" />
            <div className="flex flex-1 flex-col justify-center gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-10 w-11 self-center" />
          </div>
        ))}
      </div>

      {/* Mobile: collapsed sheet bar (PEEK strip) */}
      <div className="fixed inset-x-0 bottom-0 z-10 rounded-t-lg border-t border-separator bg-overlay pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="flex justify-center pb-3 pt-2">
          <div className="h-1 w-9 rounded-full bg-separator" />
        </div>
        <div className="flex gap-3 px-4 pb-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex w-[85%] shrink-0 gap-3 rounded-md border border-separator bg-surface p-3"
            >
              <Skeleton className="h-[var(--layout-thumb)] w-[var(--layout-card-cover-w)] rounded-sm" />
              <div className="flex flex-1 flex-col justify-center gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-10 w-11 self-center" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
