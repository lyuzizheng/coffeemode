---
name: coffeemode-issue-submission
description: File CoffeeMode GitHub issues with categories, priorities, and evidence. Use when reporting a bug, turning review findings into issues, triaging labels, or asking how to structure an issue.
---

# CoffeeMode Issue Submission

## Loop

1. Read `docs/agent/issue-guidelines.md` — it is the single source for
   categories, priorities, and the template.
2. Check for duplicates first: `gh issue list --repo lyuzizheng/coffeemode
   --state open`; extend an existing issue instead of filing a new one.
3. Classify before filing: one category label + one priority (P0–P3) from
   the guidelines table.
4. File with the five-section template (`Summary`, `Evidence`, `Impact`,
   `Suggested fix direction`, `Acceptance criteria`). Evidence must be
   concrete `file:line` references against the current branch, not vibes.
5. If a suggested fix is not implementable now (platform constraint, no
   product driver, owner action), still file the issue — the deferral
   happens at scope time, not submission time.

## Submission checklist

- [ ] Issue is not a duplicate
- [ ] One category label chosen from `docs/agent/issue-guidelines.md`
- [ ] Issue title uses a category prefix (`[BUG]`, `[SECURITY]`,
      `[DATA-INTEGRITY]`, `[PERF]`, `[ARCH]`, `[DOCS]`, `[BLOCKED-OWNER]`)
- [ ] Priority (P0–P3) is stated in the issue body
- [ ] Evidence cites file:line on the branch the reporter reviewed
- [ ] Impact names who/what breaks
- [ ] Suggested fix direction includes trade-offs
- [ ] Acceptance criteria say how the fix gets verified

## Stop And Ask

Ask before inventing product meaning, deciding priorities for the owner's
roadmap, or filing security issues that need disclosure coordination.
