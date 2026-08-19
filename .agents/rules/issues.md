# Issue Rules

GitHub issues are the intake and state ledger for fixes in
`lyuzizheng/coffeemode`. The execution loop lives in
`.agents/workflows/closed-loop.md`.

## Dedup gate

Before filing:

1. List all open issues.
2. Search component vocabulary and defect-class vocabulary across titles and
   bodies.
3. Use these verdicts:
   - same component + same defect: comment on the original;
   - one shared root cause across components: one issue listing every site;
   - independent root cause: a separate linked issue;
   - materially different recurrence after closure: a new issue referencing the
     closed issue.
4. Record the search and verdict in the issue body.

## Classification

| Prefix | Label | Meaning |
| --- | --- | --- |
| `[BUG]` | `bug` | Behavior contradicts the intended contract |
| `[SECURITY]` | `security` | Auth, secrets, injection, abuse, spoofing |
| `[DATA-INTEGRITY]` | `data-integrity` | Races, drift, lost updates, invalid persistence |
| `[PERF]` | `performance` | Unbounded or wasteful runtime work |
| `[ARCH]` | `architecture` | Boundaries, duplication, maintainability |
| `[DOCS]` | `documentation` | Incorrect or conflicting guidance |
| `[BLOCKED-OWNER]` | `blocked-owner` | Account, credential, or owner action required |

Priorities: P0 production/security/data loss; P1 incorrect behavior or major
drift; P2 bounded quality debt; P3 no current driver.

## Required issue evidence

Every new issue contains `Summary`, `Category`, `Priority`, `Evidence`, `Impact`,
`Suggested fix direction`, `Acceptance criteria`, and the dedup verdict. Evidence
uses current `file:line` references or a reproducible external trace.

The issue is a hypothesis, not a contract. Reproduce or verify it before coding,
correct stale claims publicly, fix the shared root cause, and sweep sibling call
sites with the same defect.

If the suggested direction is infeasible or has no current product driver,
comment the evidence and deferral on the issue; never half-implement it.

## Scope and closure

- One complete issue -> one branch -> one PR.
- Routine fixes name an affected area; they do not create implementation-slice
  rows or progress-log entries.
- Use `Fixes #N` only when the PR satisfies the entire issue acceptance criteria.
- If work must remain open, split it into a linked follow-up before merge or use
  `Refs #N`; never combine partial delivery with `Fixes #N`.
- A PR merged into the default branch auto-closes a correctly linked issue. Verify
  that closure instead of posting a redundant manual close comment.
- A new separable finding gets a deduplicated follow-up issue linked both ways.

Branch names use `fix/issue-<n>-<slug>` or `feat/<slice>-<slug>`. Stacked PRs state
their base and merge order.
