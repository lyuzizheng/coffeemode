# Implementation Slices

Machine-checked implementation plan. Each slice maps to required specs, dependencies, and test gates.

## Slice manifest

| ID | Title | Status | Specs | Dependencies | Test gates | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| `scaffold-nextjs` | Initialize Next.js workspace | READY | 0001 | — | typecheck, build | Next.js dev server runs |
| `design-tokens` | Migrate design system tokens | READY | 0002 | scaffold-nextjs | typecheck, build, visual | New palette in globals.css |
| `home-page` | Map + header + carousel | READY | 0001, 0002 | scaffold-nextjs, design-tokens | typecheck, build, e2e | Home page renders map |
| `api-routes` | BFF proxy routes | READY | 0001 | scaffold-nextjs | typecheck, unit, build | API routes proxy to backend |
| `cafe-detail` | Cafe detail page (SSR) | BLOCKED | 0001, 0002 | home-page, api-routes | typecheck, build, e2e | SSR detail page works |
| `explore-page` | Search and filter | BLOCKED | 0001, 0002 | home-page, api-routes | typecheck, build, e2e | Search returns results |
| `ci-setup` | CI workflows + preflight | READY | 0003 | scaffold-nextjs | preflight | CI gates pass on PR |
| `cleanup` | Remove old frontend | BLOCKED | 0001 | cafe-detail, explore-page, ci-setup | build, e2e | Old code removed |

## Status vocabulary

```text
READY     All dependencies complete, no active blockers
BLOCKED   Waiting on dependencies or unresolved decisions
COMPLETE  Implemented and verified
```

## Rules

```text
- Do not implement through a slice's active blockers
- Do not infer unresolved product or design decisions
- One production-code writer per slice
- Update this file when slice status changes
```
