import { SiteMasthead } from "@/components/site-masthead";

/**
 * Instant-loading fallback for `/search` (search-filters-v1 §7): 4 skeleton
 * rows — cover block + 2 text bars — matching the rich-row geometry so the
 * swap to real results never shifts layout. Server-safe: no hydration.
 */
export default function SearchLoading() {
  return (
    <div aria-busy="true" className="flex min-h-dvh flex-col">
      <SiteMasthead />
      <main className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-1 flex-col gap-4 px-4 pb-12 pt-5 sm:px-6">
        <div className="h-11 animate-pulse rounded-md bg-surface-secondary" aria-hidden />
        <ul className="flex flex-col" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex gap-3 px-3 py-2.5">
              <div className="h-[var(--layout-thumb)] w-[var(--layout-card-cover-w)] shrink-0 animate-pulse rounded-sm bg-surface-tertiary" />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tertiary" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
