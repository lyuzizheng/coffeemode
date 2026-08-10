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

## Dedup gate

**Every issue filing runs the dedup gate first. A near-duplicate means a
comment on the original issue, never a new issue.**

1. List all open issues: `gh issue list --repo lyuzizheng/coffeemode --state open --limit 100`.
2. Search two vocabulary families against titles and bodies:
   - **Component vocabulary** — the affected area and its synonyms: the
     file/dir, feature, service (`web`, `poi-service`, `image-service`),
     and user-facing surface (sign-in, check-in, upload, cache, map, …).
   - **Defect-class vocabulary** — the symptom class: auth/security, data
     integrity/race, cache invalidation, image pipeline, perf, docs drift,
     dead code, API contract, … .
3. Verdicts:
   - **Same component + same defect class → duplicate.** Comment on the
     original with the new evidence (file:line, extra call sites, repro);
     never create a second issue.
   - **Same defect class + shared root cause across components → one issue**
     naming the root cause, listing every affected site. File the class,
     not the instance.
   - **Same component + different defect class, or independent root causes
     → separate issue**, linked to the related one in both bodies.
   - **Original is closed and the defect re-appears, or the finding is
     materially different (different root cause, different fix surface)
     → new issue**, referencing the closed one.
4. Record the search in the issue body:
   `**Dedup check**: searched open issues for <families>; verdict: <comment
   on #N | new issue, linked to #N | no duplicate>.`

## Categories (GitHub labels)

| Category / title prefix | GitHub label | Meaning | Typical evidence |
| --- | --- | --- | --- |
| `[BUG]` | `bug` | Behavior contradicts spec or intent | file:line, repro |
| `[SECURITY]` | `security` | Auth, secrets, injection, abuse, spoofing | trust-model gap, missing cap |
| `[DATA-INTEGRITY]` | `data-integrity` | Races, drift, lost updates, orphaned rows, non-atomic writes | concurrent write path, cascade gap |
| `[PERF]` | `performance` | Unbounded work, N+1, CPU/bandwidth on the host | unbounded loop, per-request cost |
| `[ARCH]` | `architecture` | Module boundaries, duplication, fat controllers | same concept reimplemented |
| `[DOCS]` | `documentation` | Spec/doc drift, wrong guidance | doc vs code mismatch |
| `[BLOCKED-OWNER]` | `blocked-owner` | Requires owner credentials/account action | deploy, provider config, secret |

## Priorities

| Priority | Definition | Cadence |
| --- | --- | --- |
| P0 | Blocks production; security hole; data loss | Fix immediately, before anything else |
| P1 | Incorrect behavior, drift, race risk, major UX break | Fix this sprint |
| P2 | Correctness/quality debt | Fix opportunistically |
| P3 | Nice-to-have, no current product driver | Backlog; may be closed with rationale |

## Issue template

Every issue carries these sections (review-generated issues already do):

```text
## Summary
## Category   — the GitHub label (one of bug/security/data-integrity/performance/architecture/documentation/blocked-owner)
## Priority   — P0/P1/P2/P3 from the table above
## Evidence   — concrete file:line references, not vibes
## Impact     — what breaks or drifts, and for whom
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

## Critical fix

Fixers treat the issue text as a hypothesis, not a contract:

- **Verify before you trust.** Reproduce the defect against current code.
  When the issue's claims are wrong (wrong file:line, misdescribed site,
  already-compliant code), do not "fix" it blindly — correct the issue in
  a comment and in the PR with the evidence. Evidence over authority.
- **Root cause + sibling sweep (举一反三).** Fix the shared root cause, then
  grep every consumer of the touched component/pattern and fix every call
  site with the same defect in the same PR. The PR states the full site
  list explicitly, including sites the issue never named.
- **Push back with evidence.** If the issue's suggested direction is wrong
  or infeasible, say so on the issue and implement the feasible part —
  never silently implement an unreasonable plan.
- **Escalate what you find.** A new, separable problem discovered during
  the fix becomes a follow-up issue (through the Dedup gate) or a comment
  on the current issue when it is the same defect class. Link both
  directions (`Found while fixing #N` / `Follow-up: #M`).

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
