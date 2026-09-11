# Review Code

Use this workflow for code review tasks.

## Loop

1. Run `.agents/scripts/preflight.sh` — must pass.
2. Identify the issue plan or planned slice and read its affected specs.
3. Read the cumulative diff from the shared repository directly.
4. Check against spec acceptance criteria.
5. For docs/harness changes, generate and review the packet:
   - `.agents/scripts/docs-review-packet.sh <base>`
   - Apply `.agents/docs-semantic-review.md` judge checks.
6. Report findings with severity (P0/P1/P2).

## Structure gate (mandatory)

- Check every touched file against
  `docs/specs/0009-code-quality-and-module-boundaries.md` §§3–6: hard
  thresholds, same-commit split, 2nd-occurrence extraction, pattern
  justification, layer bans. Run `npm run check:structure` (from `web/`) where
  it applies, and confirm the PR `## Structure` section is filled, not blank.
- Structure failure = mandatory rework. Functional correctness NEVER waives it:
  a correct feature in an unsplit over-threshold file, with copied logic, or
  with an unjustified new abstraction MUST be returned for rework — never
  approved with a "follow-up later".
- Soft-250 files need an author response (split or reason) before approval.
- Unregistered over-threshold changes (no `[STRUCT-EXEMPT]` issue + ratchet
  entry) are P0 findings.

## Critical cleanup gate

Reject overengineering:
- No abstraction without a second concrete use case.
- No config option without a user who needs it.
- No "future-proofing" that adds indirection today.

## Independence rule

The reviewer must not be the agent that authored the patch. If no independent reviewer is available, report the gate as blocked — do not self-approve.

Deliver the review verdict (`Review verdict: APPROVED` / findings) as a comment on the issue thread, providing the gate evidence and cumulative diff audit per closed-loop Step 7. Do not call `gh pr review --approve` on GitHub: workspace agents share the repository owner credentials, and GitHub rejects PR self-approval.
