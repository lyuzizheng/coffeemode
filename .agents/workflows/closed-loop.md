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
7. **Review**: use the tier requirements. Review the complete stable diff;
   docs/harness authority also requires the independent semantic-review packet.
8. **Publish**: after push approval (unless the user already requested a PR), open
   a PR using `.github/pull_request_template.md`. Use `Fixes #N` only for a fully
   satisfied issue; otherwise use `Refs #N` and link the remaining issue.
9. **CI**: wait for the relevant CI jobs and the aggregate `ci-gate`. Fix the root
   cause of failures; never bypass a gate.
10. **Close**: merge only with explicit authority. After merge, verify GitHub
    auto-closed the issue and that linked follow-ups remain open.

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
