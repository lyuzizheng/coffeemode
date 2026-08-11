## Issue

- Fixes #<!-- issue number -->
- Fix plan comment: <!-- link to the issue comment containing the fix plan -->
- Related PR stack: <!-- if this branch is based on an unmerged branch, state the merge order -->

## Summary

<!-- One-paragraph description of what changed and why. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / code health
- [ ] Docs / harness
- [ ] Architecture / data model
- [ ] Other: __________

## Affected slice / area

<!-- e.g., `issue-27-stats-locking`, `web/lib/images`, `poi-service` -->

## Changes

- What changed and why.
- Schema/API/UI impact, if any.
- Files or packages touched.

## Test plan

- [ ] `cd web && npm run verify`
- [ ] `cd image-service && npm run typecheck && npm test`
- [ ] `cd poi-service && npm run typecheck && npm test`
- [ ] `.agents/scripts/preflight.sh`
- [ ] Independent code review (`.agents/scripts/implementation-review-packet.sh`) — for Standard/High risk
- [ ] Independent semantic review (`.agents/scripts/docs-review-packet.sh`) — if docs/harness changed
- [ ] Manual / visual check — for UI or worker flows

## Verification evidence

<!-- Paste the exact commands you ran and their results. -->

```text

```

## Risk tier

Criteria defined in `.agents/workflows/development-cycle.md` (Execution tiers).

- [ ] Fast
- [ ] Standard
- [ ] High

## Deployment / release notes

<!-- Migrations, env variables, secrets, or owner actions required. -->

## Checklist

- [ ] Issue linked with `Fixes #N`.
- [ ] Fix plan recorded in the linked issue before this PR was opened.
- [ ] Slice status updated in `docs/agent/implementation-slices.md`.
- [ ] `docs/agent/progress-log.md` updated.
- [ ] `docs/agent/current-state.md` updated if phase/focus changed.
- [ ] No separate temporary plan files; canonical docs updated if contracts changed.
- [ ] CI is green.
- [ ] Independent review completed for Standard/High risk.
- [ ] Stacked PR merge order stated (if applicable).
