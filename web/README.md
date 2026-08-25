# CoffeeMode Web

Next.js full-stack application. Spec: `../docs/specs/0001-nextjs-migration.md`.
Design system: `../docs/specs/0002-design-system.md`.

## Stack (pinned by spec)

- Next.js 16 (App Router, Turbopack default, async request APIs)
- React 19
- Tailwind CSS v4 + HeroUI v3 (no Provider needed; `@import "@heroui/styles"`)
- next-intl (en primary, zh secondary), next-themes (class strategy)
- Supabase auth only (Apple + Google OAuth) · self-hosted Postgres for app data

## Commands

```bash
npm run dev        # next dev (Turbopack)
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test         # vitest unit tests
npm run analyze      # bundle analysis (Next 16 diagnostics)
npm run check:bundle # verify bundle chunk size budgets
npm run lhci         # lighthouse CI runs against production build
```

## Next.js 16 notes (read before editing)

The bundled docs at `node_modules/next/dist/docs/` are the source of truth
for this Next.js version. Breaking changes that matter here:

- Turbopack is default for dev and build; no custom webpack config.
- `params`/`searchParams`/`cookies`/`headers` are async — always `await`.
- `revalidateTag(tag)` now requires a cacheLife profile as second argument.

## MapKit JS

Apple MapKit JS loads from the Apple CDN via `<script>` — there is no npm
package. All map components must be client components. The creation search tab
uses `/api/mapkit-token`; configure `APPLE_MAPKIT_TEAM_ID`,
`APPLE_MAPKIT_KEY_ID`, and `APPLE_MAPKIT_PRIVATE_KEY` before enabling Apple
provider search in production. Map-pin creation remains deferred.
