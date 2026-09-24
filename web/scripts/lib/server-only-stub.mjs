/**
 * esbuild alias target for the `server-only` package.
 *
 * `server-only` resolves to a throwing module outside React Server Component
 * builds; the bundled recompute script runs in plain Node where the guard is
 * meaningless, so `scripts/recompute-work-stats.mjs` aliases it here.
 */
export {};
