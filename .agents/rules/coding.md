# Coding Rules

Canonical, tool-neutral coding rules for CoffeeMode. Product and API contracts
remain in `docs/specs/`; this file owns coding procedure and style only.

## Stack boundaries

- Active application code is in `web/` (Next.js 16, HeroUI v3, Tailwind v4,
  next-intl, Postgres, Supabase Auth).
- `poi-service/` and `image-service/` are Cloudflare Workers.
- `_archive-coffeemode-frontend/` and `_archive-coffeemode-backend/` are reference
  only, not active implementation targets.
- Do not introduce Shadcn, Radix, or Material. Follow
  `docs/specs/0002-design-system.md`.
- Clients call Next.js route handlers; they never connect to Postgres directly.

## Style

- Read `web/README.md` and the task-relevant specs before writing code.
- Prefer early returns and shallow control flow.
- Use descriptive names; event handlers use a `handle` prefix.
- Prefer `const` and explicit types where they improve clarity.
- Use Tailwind classes rather than inline styles or one-off CSS files.
- Preserve accessibility on interactive elements.
- Comment why, not what. Do not add speculative abstractions, options, TODOs, or
  placeholders.

## Route handlers

- Keep `web/app/api/*` controllers thin; put business behavior in `web/lib/*`.
- Return the existing JSON error shape and status conventions.
- Handle expected failures with early returns. Log unexpected failures safely and
  return 500 without exposing upstream bodies or secrets.
- Update the owning spec when a public route contract changes.

## Tests

Follow `docs/specs/0003-testing-and-ci.md` and
`.agents/workflows/testing.md`. Tests encode the intended contract, not a buggy
implementation. Mocks cannot prove SQL or trigger behavior; use the real-Postgres
gate for those boundaries.
