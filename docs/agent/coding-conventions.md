# Coding Conventions

Canonical, tool-neutral coding rules for CoffeeMode. Every editor/agent rule file (`.cursorrules`, `.cursor/`, `.windsurf/`, `.trae/`, `.github/prompts/`) points here so there is one source of truth for how code is written in this repo.

This file owns **coding style**. It does not own product or API contracts — those live in `docs/specs/`. For orientation and the source-of-truth hierarchy, follow `docs/agent/reading-order.md` and `docs/STRUCTURE.md`.

## Stack

- Active code lives in `web/` (Next.js 16 full-stack App Router + self-hosted Postgres + Supabase Auth). Cloudflare Workers back the POI cache (`poi-service/`) and image upload (`image-service/`).
- Legacy Vite frontend and Java/Spring backend are archived under `_archive-coffeemode-frontend/` and `_archive-coffeemode-backend/` — reference only, not active targets.
- UI is TailwindCSS v4 + HeroUI v3 (installed via `@heroui/react`). Build bespoke components on top of HeroUI and the design tokens in `web/app/globals.css`. Do **not** introduce Shadcn, Radix, or Material — see `docs/specs/0002-design-system.md`.
- Data layer: React (Client Components) → TanStack Query v5 → Next.js `/api/*` route handlers → Postgres. The client never talks to Postgres directly (`docs/specs/0001-nextjs-migration.md`).

## Style

- Read `web/README.md` and the task-relevant `docs/specs/*.md` before planning or writing code.
- Prefer early returns for readability; avoid deep nesting.
- Style with Tailwind classes, not inline `style` or separate CSS.
- Descriptive names. Event handlers use a `handle` prefix (`handleClick`, `handleKeyDown`).
- Prefer `const` arrow functions and a declared type where practical.
- Implement accessibility on interactive elements (`tabindex`, `aria-label`, keyboard handlers).
- Comment the *why* for non-obvious logic; number the steps when a function does more than one thing.
- DRY, complete, no TODOs/placeholders. Include all imports. Say so when there may be no correct answer rather than guessing.

## Backend route handlers (`web/app/api/`)

- Follow the existing patterns in `web/app/api/*`; keep controllers thin and put business logic in `web/lib/*`.
- Return `NextResponse.json({ error, message }, { status })`.
- Use 4-digit business error codes where appropriate: `4xxx` client errors, `5xxx` server errors.
- Do not wrap handler bodies in try/catch for expected errors — handle with early returns. Log unexpected errors and return 500.
- Document new API routes as JSDoc/comments in `web/app/api/<route>/route.ts`, and update `docs/specs/0001-nextjs-migration.md` if the contract changes.

## Testing

Canonical testing policy: `docs/specs/0003-testing-and-ci.md`.

- Three layers, narrowest first: unit (Vitest/RTL), integration-mocked (API routes),
  **integration-real-DB** (`npm run test:integration`), e2e (Playwright, post-MVP).
- **Any change touching `web/db/migrations/*.sql`, embedded SQL in `web/lib/`, or
  DB-backed flows MUST run `npm run test:integration` green** (or extend the suite
  when the behavior is not covered yet) — never ship SQL validated by reasoning alone.
- Integration tests live in `web/tests/integration/` behind `RUN_INTEGRATION=1`;
  they must stay skipped (not failing) in plain `npm test`. Assert both the returned
  value and the stored DB state. See `docs/agent/local-dev-stack.md` to run the stack.
- Unit tests must encode the CONTRACT (correct parameter order, real return shapes),
  not the current buggy behavior — mocks cannot validate SQL, so SQL semantics belong
  to the integration suite.

## Terminal

- Run frontend/backend commands from `web/` (`cd web` first).
