# Issue Guidelines

Canonical rules for filing, triaging, and fixing GitHub issues in
`lyuzizheng/coffeemode`. Both repo skills (`coffeemode-issue-submission`,
`coffeemode-issue-review-fix`) and agents picking up issues follow this doc.

## Lifecycle

```text
1. Submit   — file the issue with the template below, assign category + priority.
2. Triage   — verify the claim against current code; re-classify if the code changed.
3. Scope    — decide solvable-now vs deferred (see Deferral policy).
4. Fix      — one issue → one branch → one PR with "Fixes #N" (see PR conventions).
5. Close    — after the PR merges, comment "Fixed in #N" and close.
```

## Categories (GitHub labels)

| Label | Meaning | Typical evidence |
| --- | --- | --- |
| `bug` | Behavior contradicts spec or intent | file:line, repro |
| `security` | Auth, secrets, injection, abuse, spoofing | trust-model gap, missing cap |
| `data-integrity` | Races, drift, lost updates, orphaned rows, non-atomic writes | concurrent write path, cascade gap |
| `performance` | Unbounded work, N+1, CPU/bandwidth on the host | unbounded loop, per-request cost |
| `architecture` | Module boundaries, duplication, fat controllers | same concept reimplemented |
| `docs` | Spec/doc drift, wrong guidance | doc vs code mismatch |
| `blocked-owner` | Requires owner credentials/account action | deploy, provider config, secret |

## Priorities

| Priority | Definition | Cadence |
| --- | --- | --- |
| P0 | Blocks production; security hole; data loss | Fix immediately, before anything else |
| P1 | Incorrect behavior, drift, race risk, major UX break | Fix this sprint |
| P2 | Correctness/quality debt | Fix opportunistically |
| P3 | Nice-to-have, no current product driver | Backlog; may be closed with rationale |

## Issue template

Every issue carries these five sections (review-generated issues already do):

```text
## Summary
## Evidence      — concrete file:line references, not vibes
## Impact        — what breaks or drifts, and for whom
## Suggested fix direction   — options, with trade-offs
## Acceptance criteria      — how the fix will be verified
```

## Deferral policy

Defer (do not half-implement) when any of these hold:

- No product feature currently drives the change (e.g. normalizing JSONB
  arrays that no query needs yet).
- A platform/account constraint blocks it (e.g. native `sharp` cannot run on
  Cloudflare Workers; Cloudflare Images provisioning is an owner action).
- The change is an irreversible schema rewrite with no data path.

How to defer:

1. Comment on the issue with the concrete rationale and the follow-up
   reference (a line in `docs/agent/pending-user-actions.md`, a backlog
   issue, or an ADR entry).
2. Keep the issue open so the decision stays visible.
3. Do the parts that ARE solvable now and say so explicitly in the PR.

## PR conventions

- One issue → one PR; branch name `fix/issue-<n>-<slug>`.
- PR body starts with `Fixes #N` so GitHub links them.
- Stacked PRs: if the fix branch is based on an unmerged branch, state the
  required merge order in the PR description.
- Verification before push: `.agents/scripts/preflight.sh` green, package
  tests green (`web`, `poi-service`, `image-service`), typecheck clean.
- Register the fix in `docs/agent/implementation-slices.md` and update
  `docs/agent/progress-log.md` in the same PR.
- Close the issue only after the PR merges.
