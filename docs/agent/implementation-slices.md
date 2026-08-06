# Implementation Slices

Machine-checked implementation plan derived from `docs/specs/0001-nextjs-migration.md` phases. Each slice maps to required specs, dependencies, blockers, and test gates. Coding agents load one slice's context with `.agents/scripts/context-for-slice.sh <slice-id>` instead of reading every spec.

## Slice manifest

| ID | Title | Status | Specs | Dependencies | Active blockers | Test gates | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| scaffold-nextjs | Initialize Next.js workspace in web/ | COMPLETE | 0001, 0002 | none | none | typecheck, build | Next.js dev server and production build run in web/ |
| design-tokens | Design tokens, theme, dark mode | COMPLETE | 0002 | scaffold-nextjs | none | typecheck, build, visual | 2026 token set in globals.css, dark mode works |
| auth-foundation | Supabase OAuth + profiles + Neon helpers | IN-PROGRESS | 0001 | scaffold-nextjs | none | typecheck, unit, build | Apple/Google OAuth round-trip, profiles upsert, Neon pool |
| map-home | Apple MapKit home map | BLOCKED | 0001, 0002 | scaffold-nextjs, design-tokens | Apple Developer Program account (MapKit JS token) | typecheck, build, e2e | Full-screen map, custom markers, clustering, dark scheme, geolocation |
| poi-cache-service | POI cache service (Workers + D1 + KV) | COMPLETE | 0001 | none | none | unit, deploy | Google/Apple POI resolve, cache, and distance search; Google Places key lives only in this service |
| places-proxy | Next.js /api/places/* route handlers proxying the POI service | COMPLETE | 0001 | poi-cache-service | none | typecheck, unit, build | Server-side POI client + search/resolve routes; Google key never in web/ |
| discovery-sheet | Bottom sheet + swipe cards + URL sync | BLOCKED | 0001, 0002 | map-home | none | typecheck, build, e2e | PEEK/HALF/FULL sheet with horizontal cards, back-button-safe URL sync |
| image-pipeline | R2 + sharp upload pipeline | BLOCKED | 0001 | auth-foundation | none | typecheck, unit, build | Multi-size WebP/JPEG upload, gallery JSONB, R2 metadata |
| cafe-creation | Creation flow = first check-in | BLOCKED | 0001, 0002 | auth-foundation, discovery-sheet, poi-cache-service, image-pipeline | none | typecheck, unit, build, e2e | Google Maps link import + map-tap creation, dedupe, creator check-in |
| checkin-system | Check-in drawer + sliders | BLOCKED | 0001, 0002 | cafe-creation | none | typecheck, unit, build, e2e | 0-100 sliders, policy chips with unknown, photos, repeat check-in flow |
| work-profile | Aggregation + dual scores | BLOCKED | 0001 | checkin-system | none | typecheck, unit, build | Incremental work_stats, experience + weighted scores, nightly recompute |
| search-filters | Hybrid search + nomad filters | BLOCKED | 0001, 0002 | discovery-sheet, poi-cache-service | none | typecheck, unit, build, e2e | Distance search over own cafes + saved POIs; external search persists POIs |
| navigation-prompt | Navigation tracking + return prompt | BLOCKED | 0001 | checkin-system | none | typecheck, unit, e2e | Navigation events recorded; ClassPass-style check-in prompt on return |
| profile-page | User profile page | BLOCKED | 0001, 0002 | auth-foundation, checkin-system | none | typecheck, build, e2e | /profile lists the user's check-ins |
| seo-sharing | SSR deep links + share flow | BLOCKED | 0001, 0002 | discovery-sheet | none | typecheck, build, e2e | /cafes/[id] SSR deep link, OG images, Web Share API |
| deploy-vps | Docker + VPS + CDN + CI/CD | BLOCKED | 0001, 0003 | work-profile, search-filters, navigation-prompt, seo-sharing | none | build, deploy | Production on VPS behind Cloudflare CDN with green pipeline |
| cleanup-legacy | Remove old Vite frontend + Java backend | BLOCKED | 0001 | deploy-vps | none | build, e2e | Legacy code removed after feature parity is verified |

## Status vocabulary

```text
READY       All dependencies COMPLETE, no active blockers — implementation permitted
BLOCKED     Waiting on dependencies or active blockers
IN-PROGRESS One writer actively implementing; finish before starting another slice
COMPLETE    Implemented and verified against the test gates
```

## Rules

```text
- Keep the table columns unchanged; harness scripts parse it.
- Do not implement through a slice's active blockers or incomplete dependencies.
- Do not infer unresolved product or design decisions.
- One production-code writer per slice.
- Implementation, testing, and review of one change share the same slice ID.
- Update this file when a slice status or blocker changes.
```
