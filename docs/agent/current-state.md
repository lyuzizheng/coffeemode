# Current State

## Phase

Pre-migration. The project runs as a Vite React SPA in `coffeemode-frontend/` with a Java Spring Boot backend in `coffeemode_backend/`.

## Active focus

Migrating to Next.js App Router (spec 0001) and establishing the design system (spec 0002).

## What exists

```text
coffeemode-frontend/     Vite + React 19 + Tailwind v4 + Shadcn UI + MapLibre
coffeemode_backend/      Java 21 + Spring Boot + Gradle
coffeemode-script/       Cloudflare Worker for image processing
docs/                    This documentation system (new)
.agents/                 Agent workflows and scripts (new)
```

## What's next

```text
1. Scaffold Next.js in apps/web/ (slice: scaffold-nextjs)
2. Migrate design tokens and Shadcn components (slice: design-tokens)
3. Migrate map + home page (slice: home-page)
4. API routes + data fetching (slice: api-routes)
5. Cafe detail + explore pages (slice: pages)
```

## Known issues

```text
- No tests exist in the frontend
- No routing (single-page SPA)
- UI uses generic Shadcn defaults, no distinctive identity
- CI skips frontend entirely (only backend-ci.yml)
- repo_notes.md is the only documentation (replaced by docs/)
```
