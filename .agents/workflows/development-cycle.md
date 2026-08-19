# Development Cycle

Use this workflow for the implementation portion of
`.agents/workflows/closed-loop.md`.

## Loop

1. Confirm the issue/fix plan, affected specs, and success criteria.
2. For a planned product feature, load its generated slice context and obey
   `STOP`, `READY`, or `COMPLETE`. Routine fixes use the issue and affected area;
   they do not create a slice row.
3. Make the smallest complete change with one production-code writer.
4. Add or update the narrowest test that proves changed behavior and important
   failure paths.
5. Run focused tests, then the relevant package gate selected by
   `docs/specs/0003-testing-and-ci.md`.
6. Run preflight after changes.
7. Run the review required by the tier on the final stable cumulative diff.
8. Update specs only when behavior/contracts changed, current state only when the
   phase or blockers changed, and slice state only for an existing planned slice.

## Execution tiers

This table is the single definition of Fast, Standard, and High.

| Tier | When | Required evidence | Independent review |
| --- | --- | --- | --- |
| Fast | Typo, formatting, comment-only, no behavior | focused check + preflight | no |
| Standard | Bounded feature, bug fix, refactor, or test change | focused test + relevant package gate + preflight + CI | required for production behavior or material test evidence |
| High | Architecture, migration, auth/security/secrets, public API, deployment, agent/CI authority | all relevant local gates + preflight + CI | required on final stable diff |

Risk follows consequences, not line count. Any docs, agent-system, Codex binding,
or CI/harness authority change additionally requires the independent semantic
review in `.agents/docs-semantic-review.md`.
