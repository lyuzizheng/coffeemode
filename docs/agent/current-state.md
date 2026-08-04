# Current State

## Phase

Pre-rewrite. Design grill complete (Rounds 1–6, all decisions confirmed in `docs/alignment-temp/alignment-progress.md`). Specs 0001/0002 rewritten and accepted. Next.js scaffold pending baseline merge.

## Active focus

Slice 1: merge harness/docs branch to `main`, then scaffold `web/` (Next.js 15 + HeroUI v3 + Tailwind v4) per spec 0001 Phase 1.

## What exists

```text
coffeemode-frontend/     Vite + React 19 + Tailwind v4 + Shadcn UI (old, reference only)
coffeemode_backend/      Java 21 + Spring Boot + Gradle (old, being dropped)
coffeemode-script/       Cloudflare Worker for image upload (being retired → Next.js + R2)
docs/specs/              0001 Next.js rewrite, 0002 design system, 0003 testing/CI
docs/alignment-temp/     Grill decisions log (Rounds 1–6, complete)
.agents/                 Agent workflows and scripts
```

## What's next

```text
1. Merge feat/agent-harness-and-docs-system → main (baseline fix)
2. Scaffold Next.js in web/ + auth (Supabase) + db (Neon)  [spec 0001 Phase 1]
3. Map + bottom sheet + swipe cards                          [Phase 2]
4. POI cache service (Workers + D1 + KV) + creation flow     [Phase 3]
5. Check-in system + work profile + aggregation              [Phase 4]
6. Polish + VPS deploy                                       [Phase 5]
```

## Known issues

```text
- main branch lacks docs/harness (only on feat/agent-harness-and-docs-system)
- No tests exist in the old frontend
- Old UI uses generic Shadcn defaults, retro theme — both superseded by spec 0002
- Apple Developer Program purchase pending (needed for MapKit JS)
```
