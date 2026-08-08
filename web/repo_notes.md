# CoffeeMode Web — File Notes

## 2026-08-08 Part A (feat/impl-design-tokens)

- `app/globals.css`
  - Added `--secondary` / `--secondary-foreground` sage brand tokens in light and dark blocks.
  - Codified small radius scale (`--radius-sm/md/lg/xl`) and pinned `--radius` / `--field-radius` to `--radius-md`.
  - Pinned `.card` to `var(--radius-md)` (4px).
  - Added `--color-secondary*` mappings in `@theme` for Tailwind v4 utilities.
  - Verified `@theme` shadow tokens and removed the second shadow from `--shadow-map` to match the spec.

- `app/providers.tsx`
  - Mounted `<Toast.Provider>` from `@heroui/react` at the top level of the provider tree.

- `messages/en.json` / `messages/zh.json`
  - Added `profile`, `create`, `checkIn`, `success`, and `search` namespaces.
  - Added `themePreview` keys for the new prototype sections.

- `app/theme-preview/sections/score-slider-section.tsx`
  - Static HeroUI Slider prototype for all 0–100 check-in dimensions plus overall.

- `app/theme-preview/sections/policy-chips-section.tsx`
  - Reusable `PolicyChips` component and selectable `min_spend` / `max_stay` chip groups using the sage secondary token.

- `app/theme-preview/sections/check-in-success-section.tsx`
  - `CheckInSuccessCard` bottom-card prototype with cafe name, new work score, actions, and a subtle coffee-steam hint.

- `app/theme-preview/sections/profile-section.tsx`
  - `ProfileHeader` with avatar, name, city, stats row, and tabbed empty-state lists for My Cafes / My Check-ins.

- `app/theme-preview/sections/search-filter-section.tsx`
  - `SearchFilter` prototype with city `Select`, dimension-minima `Slider`s, `PolicyChips`, and `open_now` `Switch`.

- `app/theme-preview/theme-preview.tsx`
  - Wired all new prototype sections into the `/theme-preview` page.

- `app/theme-preview/preview-sections.tsx`
  - Re-exported the new section components for the barrel import.

- `app/theme-preview/sections/color-section.tsx`
  - Added `secondary` and `secondary-foreground` swatches to the brand token group.

## 2026-08-09 Part B (feat/impl-auth-middleware)

- `web/proxy.ts`
  - Supabase SSR session-refresh proxy that runs on every non-asset request.
  - Next.js 16 renamed the `middleware` file convention to `proxy`; this file
    exports `proxy` and `config.matcher`.
  - Refreshes tokens and forwards refreshed cookies without blocking public routes.

- `web/db/migrations/0002_checkins_and_indexes.sql`
  - Adds `updated_at`, `deleted_at`, `likes_count` to `checkins`.
  - Creates the `checkin_likes` table.
  - Documents the `source` field on `StoredImage` records in `cafes.gallery` / `checkins.photos`.
  - Adds Phase 1 indexes: `idx_cafes_created_by`, `idx_cafes_apple_poi_id`,
    `idx_profiles_current_city`, `idx_checkins_user_visited`, `idx_checkins_deleted_at`,
    GIN on `cafes.gallery` and `checkins.photos`, plus the existing full-text / location indexes.

- `web/types/images.ts`
  - Added `StoredImageSource` (`{ type, id }`) and an optional `source` field on `StoredImage`.

- `web/types/checkins.ts`
  - Added `CheckInScores`, `CheckInPolicy` values, `CheckIn`, `CheckInInput`, and `CheckInLike` types.

- `web/types/profile.ts`
  - Added `Profile`, `ProfileStats`, and `ProfileWithStats` types aligned with the `profiles` table.

- `web/lib/stats/aggregate.ts`
  - Implements the recency-weighted `work_stats` aggregation algorithm from spec 0001.
  - Supports per-user `0.6^rank` weighting, optional `social_weight`, policy counting,
    `incrementalUpdateWorkStats`, `recomputeWorkStats`, and `recomputeAllWorkStats`.

- `web/tests/stats/aggregate.test.ts`
  - Unit tests for first check-in, repeat recency weighting, edit recompute,
    soft-delete exclusion, social-weight hook, and composite normalization.

- `web/tests/proxy.test.ts`
  - Unit tests for session cookie forwarding, missing-env fallthrough, and matcher exclusions.
