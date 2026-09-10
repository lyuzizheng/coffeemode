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

### Decidable structure checks

Pass/fail items for everyday decisions. Threshold numbers are owned by
`docs/specs/0009-code-quality-and-module-boundaries.md` §3 (machine mirror:
`web/structure.config.mjs`, enforced by `npm run check:structure` from `web/`);
this file mirrors them and MUST NOT fork them — change numbers only via the 0009
改数规则 (spec §3 + `structure.config.mjs` + `.jscpd.json` in the same PR).

- File ≤400 lines hard / ≤250 soft; function ≤80 lines; complexity ≤15;
  depth ≤4; params ≤5. A commit crossing a hard limit MUST split in the same
  commit (0009 §4). ❌ adding a 10-line branch to a 410-line file "to split later".
- No second copy: identical body ≥3 lines, or a block ≥5 lines / ≥50 tokens,
  MUST be extracted to a helper on its 2nd occurrence (0009 §5).
  ❌ pasting a coordinate check into a second route instead of sharing it.
- Repeated shape → factory/composition function with differences as parameters
  (0009 §5). ❌ cloning a whole handler skeleton and tweaking two fields.
- New abstractions name the pattern (Factory / Strategy / Adapter / Facade / DI)
  plus the rejected alternative; one call site is rejected unless the 2nd
  implementation is named (0009 §6). ❌ wrapping a single call in a class "for DI".
- One layer, one job: no SQL in `app/api`, no `lib/db` imports in `components`,
  no validation/projection living in `lib/db` (0009 §§1–2).
  ❌ putting request parsing next to a SQL query because "it is just a few lines".

## Route handlers

- Keep `web/app/api/*` controllers thin; put business behavior in `web/lib/*`.
- Enforce a rate limit bucket on every route handler (`app/api/*/route.ts`) defined in `web/config/rate-limits.yaml` via `checkRateLimit` or `rateLimiter.check` (DG74).
- Return the existing JSON error shape and status conventions.
- Handle expected failures with early returns. Log unexpected failures safely and
  return 500 without exposing upstream bodies or secrets.
- Update the owning spec when a public route contract changes.

## Structure

- Module boundaries, size thresholds, split/extract rules, pattern selection,
  and exemptions live in `docs/specs/0009-code-quality-and-module-boundaries.md`.
  Structure questions defer to that spec; this file does not restate its numbers.

## Tests

Follow `docs/specs/0003-testing-and-ci.md` and
`.agents/workflows/testing.md`. Tests encode the intended contract, not a buggy
implementation. Mocks cannot prove SQL or trigger behavior; use the real-Postgres
gate for those boundaries.
