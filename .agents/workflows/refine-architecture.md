# Architecture Refinement

Use this workflow when improving CoffeeMode's code structure, module boundaries, or repo layout.

## Loop

1. Run `.agents/scripts/preflight.sh`.
2. Read `docs/adr/` (status-bearing) and task-relevant specs. Accepted decisions are constraints, not defaults — challenge them only with new evidence.
3. State the concrete problem being removed. No problem statement, no refactor.
4. Make the smallest structural change that removes the problem; preserve unrelated behavior.
5. Keep the slice's test gates green plus any focused checks that prove the boundary moved correctly.
6. Record the outcome: update specs/ADRs when contracts change, then re-run preflight.

## Guardrails

- One production-code writer; no concurrent structural edits.
- No speculative abstractions, framework swaps, or dependency additions without a failing case they solve.
- Public API boundaries (route handlers, POI service contract, R2 paths) change only with a spec update in the same change.
