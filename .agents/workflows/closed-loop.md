# Closed-Loop Delivery

This is the single canonical agent procedure from finding work through verified
issue closure.

```text
discover -> deduplicate/file -> verify -> scope/plan -> implement
-> local gates -> independent review -> CI -> PR -> merge -> verify closure
```

## Loop

1. **Orient**: run preflight and follow `.agents/README.md`.
2. **Intake**: verify the referenced issue, or run the dedup gate in
   `.agents/rules/issues.md` and file one with evidence and acceptance criteria.
3. **Verify and scope**: treat the issue as a hypothesis. Reproduce the problem,
   identify the first root cause, sweep sibling consumers, and split unrelated or
   deferred work into linked follow-ups.
4. **Plan on the issue**: record affected areas, contract/schema/UI impact,
   relevant tests, docs, risk tier, and residual decisions. A planned product
   feature uses an existing slice context; a routine fix does not create a slice.
5. **Implement**: follow `.agents/workflows/development-cycle.md` on one branch
   with one production-code writer.
6. **Verify**: run focused tests and the relevant package gate. Run real Postgres
   for migrations, SQL, triggers, or DB-backed flows. Run browser/manual evidence
   when user-visible behavior changes.
7. **Review**: run independent code review (`.agents/workflows/review-code.md`) on
   the final stable cumulative diff per tier requirements in
   `.agents/workflows/development-cycle.md` (Standard/High require an
   independent reviewer who did not author the patch; Fast does not).
   Docs/harness authority also requires the independent semantic-review packet
   (`.agents/docs-semantic-review.md` via
   `.agents/scripts/docs-review-packet.sh <base>`).
8. **Publish**: always create a PR after completing the development cycle and
   follow this loop until the PR is ready to merge, per `AGENTS.md`. Open the
   PR using `.github/pull_request_template.md`. **PR title MUST start with the Multica Issue Identifier** (e.g. `BRAWUKA-1: [#236] <Title>`) for automatic PR linking. Use `Fixes #N` / `Closes <IDENTIFIER>` only for a fully
   satisfied issue; otherwise use `Refs #N` / `Refs <IDENTIFIER>` and link the remaining issue.
9. **CI**: wait for the relevant CI jobs and the aggregate `ci-gate`. Fix the root
   cause of failures; never bypass a gate.
10. **Close**: merge only with explicit authority. After merge, verify GitHub
    auto-closed the issue and that linked follow-ups remain open. The independent
   code reviewer must not be the patch author (`.agents/workflows/review-code.md`
   Independence rule).

## Act or ask

Proceed on clear, in-scope, reversible work already authorized by the user. A fix
plan is durable context, not a mandatory confirmation pause.

Stop only when the specs do not answer a decision involving:

- money, pricing, or data-correctness meaning;
- irreversible data shape or migration;
- security, secrets, abuse, authentication, authority, or trust;
- user-visible identity or product meaning;
- external side effects such as deployment, mail, or third-party mutation;
- a materially different fix direction or scope;
- push/PR/merge authority not already granted.

## Completion evidence

The final report names the issue and PR state, exact commands/results, independent
review verdicts, CI result, remaining follow-ups, and whether merge/closure is
complete or waiting on explicit authority.
