# 0001. Next.js Migration Spec

## Goal

Migrate CoffeeMode from a Vite React SPA to a Next.js App Router application, gaining server-side rendering, file-based routing, API routes, and a production-grade deployment story — while preserving the existing map-centric UX and component library.

## Status

Accepted

## Stable decisions

### Framework

```text
Next.js 15+ (App Router, Turbopack dev)
React 19 (Server Components + Client Components)
TypeScript strict mode
pnpm workspace (monorepo-ready)
Tailwind CSS v4 (already in use, carries over)
Shadcn UI (already in use, carries over)
```

### Project structure

```text
coffeemode/
  apps/
    web/                    # Next.js application
      app/                  # App Router
        layout.tsx          # Root layout: fonts, theme provider, metadata
        page.tsx            # Home: map + cafe carousel (server shell, client map)
        cafes/
          [id]/
            page.tsx        # Cafe detail page (SSR/SSG)
        explore/
          page.tsx          # Search/filter results page
        api/
          cafes/
            route.ts        # BFF proxy to Java backend
          google-maps/
            resolve/
              route.ts      # Google Maps link resolution
      components/           # Shared React components
        ui/                 # Shadcn primitives
        map/                # Map components (all "use client")
        cafe/               # Cafe cards, carousel, detail
        layout/             # Header, navigation, footer
      lib/                  # Utilities, API client, constants
      hooks/                # Client-side hooks (TanStack Query)
      types/                # Shared TypeScript types
      styles/
        globals.css         # Tailwind + design tokens
      next.config.ts
      tailwind.config.ts
      tsconfig.json
      package.json
  packages/
    shared/                 # (future) shared types/utils between apps
  docs/                     # This documentation system
  .agents/                  # Agent workflows and scripts
  package.json              # Workspace root
  pnpm-workspace.yaml
```

### Rendering strategy

| Surface | Strategy | Rationale |
| --- | --- | --- |
| Home map view | Client Component shell | MapLibre/Google Maps require browser APIs |
| Cafe carousel | Server Component + client islands | SSR cafe data, client scroll interaction |
| Cafe detail page | SSR with streaming | SEO + fast initial paint, client interactivity |
| Explore/search | SSR + client filters | Server renders initial results, client refines |
| API routes | Route Handlers | BFF proxy to Java backend, hide internal URLs |
| Layout/header | Server Component | Static shell, client theme toggle |

### Data fetching

```text
Server Components: direct fetch to Java backend (server-side)
Client Components: TanStack Query v5 with API route as base URL
Mutations: TanStack Query useMutation -> API route -> Java backend
Cache: Next.js fetch cache for server reads, TanStack Query cache for client
Revalidation: on-demand via API route after mutations
```

### Map handling

All map components remain Client Components (`"use client"`):

```text
MapLibre GL: dynamic import with ssr: false
Google Maps: script loaded client-side only
Geolocation: browser API, client-only
Map state: local component state, not URL-driven in MVP
```

### Routing migration

| Current (SPA) | Next.js App Router |
| --- | --- |
| `App.tsx` single view | `app/page.tsx` (home map) |
| No routing | `app/cafes/[id]/page.tsx` (detail) |
| No routing | `app/explore/page.tsx` (search) |
| Modal: CreateCafeModal | Dialog component (stays client) |

### Environment and config

```text
NEXT_PUBLIC_API_URL       -> client-side API base (defaults to /api)
BACKEND_URL               -> server-side Java backend URL (not exposed)
NEXT_PUBLIC_MAP_PROVIDER  -> "google" | "openfreemap" (default: openfreemap)
GOOGLE_MAPS_API_KEY       -> server-side only (via API route proxy)
```

### Deployment

```text
Target: Vercel (preferred) or Docker standalone
Build: next build with Turbopack
Output: standalone for Docker, default for Vercel
Java backend: unchanged, deployed separately
```

## Migration phases

### Phase 1: Scaffold (this spec's first slice)

```text
1. Initialize Next.js app in apps/web/
2. Configure pnpm workspace
3. Migrate Tailwind v4 + design tokens (globals.css)
4. Migrate Shadcn UI components
5. Set up root layout with theme provider
6. Verify dev server runs with existing token system
```

### Phase 2: Core pages

```text
1. Home page: map + header + cafe carousel
2. API routes: proxy /api/cafes, /api/google-maps/resolve
3. TanStack Query provider (client)
4. Cafe detail page (SSR)
5. Explore page with search
```

### Phase 3: Feature parity

```text
1. Create cafe flow (Google Maps import)
2. User auth integration
3. Dark mode
4. Responsive/mobile layout
5. SEO metadata and Open Graph
```

### Phase 4: Cleanup

```text
1. Remove old coffeemode-frontend/ directory
2. Update all CI workflows
3. Update documentation references
4. Archive old Vite config
```

## Edge cases

```text
MapLibre GL requires window — must use next/dynamic with ssr: false
Google Maps script must not load during SSR
Shadcn dialog/sheet components use Radix portals — verify SSR hydration
TanStack Query dehydrate/hydrate for SSR pages
Large map style JSON files — import as static assets
```

## Tests / acceptance criteria

```text
- next dev starts without errors
- next build completes with zero TypeScript errors
- Home page renders map (client) with SSR shell
- Cafe data loads through API route proxy
- Cafe detail page is server-rendered (view-source shows content)
- Dark mode toggle persists across navigation
- All existing Shadcn components render correctly
- Lighthouse performance >= 80 on cafe detail page
- No client-side JavaScript shipped for static layout shell
- pnpm lint passes with zero errors
```
