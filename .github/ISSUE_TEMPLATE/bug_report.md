---
name: Bug / Functional Issue
about: Report a functional, architectural, or extensibility problem in CoffeeMode
title: "[BUG] "
labels: bug
assignees: []
---

## Summary

One or two sentences describing the problem.

## Type of issue

- [ ] Functional bug (runtime error, incorrect data, race condition)
- [ ] Database design / data integrity
- [ ] Code structure / maintainability
- [ ] Duplicated or inconsistent logic
- [ ] Over-engineering / unnecessary complexity
- [ ] Lack of extensibility / hard-coded behavior
- [ ] Performance / scalability

## Affected area

- [ ] `web/` Next.js app
- [ ] `web/db/migrations`
- [ ] `web/app/api`
- [ ] `web/lib`
- [ ] `poi-service`
- [ ] `image-service`
- [ ] `docs/specs` or `docs/adr`
- [ ] Other: __________

## Steps to reproduce (if runtime bug)

1. ...
2. ...
3. ...

## Expected behavior

What should happen.

## Actual behavior

What happens now. Include error messages, logs, or screenshots.

## Evidence and code references

Please link to the specific files and line ranges. Example:

- `web/lib/db/checkins.ts:12-37`
- `web/db/migrations/0001_init.sql:27-35`
- `poi-service/src/store.ts:117-154`

If this contradicts a spec or ADR, link to it (e.g. `docs/specs/0001-nextjs-migration.md`).

## Impact

- Who is affected?
- What could go wrong if this is not fixed?
- Is it blocking other work?

## Suggested fix direction

Optional high-level approach. Do not over-specify implementation details.

## Environment

- OS / platform:
- Node version:
- Postgres / PostGIS version:
- Cloudflare Workers environment (if relevant):

## Additional context

Any related issues, PRs, or ADRs.
