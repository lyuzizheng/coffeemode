# Design Grill Workflow

Use this to continue product/design alignment for CoffeeMode.

## Inputs

- `docs/agent/current-state.md`
- `docs/alignment-temp/alignment-progress.md`
- Task-relevant specs (`docs/specs/`)

## Steps

1. Identify the highest-risk unresolved or partial area.
2. Check if existing specs already answer the question.
3. Prepare a focused batch of 5-10 related questions for each grill round.
4. Do not fall back to a one-question-at-a-time interview; put the highest-risk or blocking questions first in the batch.
5. Provide a recommended answer with tradeoffs for each question.
6. Record accepted decisions in `alignment-progress.md`.
7. Move stable implementation guidance into the canonical spec.
8. Remove or rewrite stale temp notes.
9. Update `docs/agent/progress-log.md`.
10. Run the deterministic gate: `.agents/scripts/preflight.sh`.

## Question Quality Bar

Each grill question should:

```text
name the decision
explain why it matters
recommend a default answer
make tradeoffs explicit
avoid overcomplicating the product
```

Current priorities must be read from `docs/agent/current-state.md` and `docs/alignment-temp/alignment-progress.md`. Do not copy them into this workflow.
