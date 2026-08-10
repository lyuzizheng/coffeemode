---
name: coffeemode-issue-submission
description: File CoffeeMode GitHub issues with categories, priorities, and evidence. Use when reporting a bug, turning review findings into issues, triaging labels, or asking how to structure an issue.
---

# CoffeeMode Issue Submission

## Loop

1. Read `docs/agent/issue-guidelines.md` — it is the single source for
   categories, priorities, the template, and the Dedup gate.
2. **Run the Dedup gate** (guidelines §Dedup gate) before writing anything:
   - List all open issues: `gh issue list --repo lyuzizheng/coffeemode
     --state open --limit 100`.
   - Search two vocabulary families — **component** (area/service/feature
     and synonyms) × **defect class** (symptom class, e.g. auth, data
     integrity, cache, perf, docs drift) — against titles and bodies.
   - Verdicts: same component + same defect → **comment on the original**
     with the new evidence, never a new issue. Same defect + shared root
     cause across components → **one root-cause issue** listing every
     affected site. Different defect or independent root cause → new
     issue, linked to the related one. Closed + re-appearing or materially
     different → new issue referencing the closed one.
   - Record the verdict in the issue body: `**Dedup check**: …`.
3. Classify before filing: one category label + one priority (P0–P3) from
   the guidelines table.
4. File with the five-section template (`Summary`, `Evidence`, `Impact`,
   `Suggested fix direction`, `Acceptance criteria`). Evidence must be
   concrete `file:line` references against the current branch, not vibes.
5. If a suggested fix is not implementable now (platform constraint, no
   product driver, owner action), still file the issue — the deferral
   happens at scope time, not submission time.

## Submission checklist

- [ ] Dedup gate run (component × defect-class vocabularies) and verdict
      recorded in the issue body
- [ ] Near-duplicate → commented on the original instead of a new issue
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
