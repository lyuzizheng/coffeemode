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

## Critical cleanup gate

Reject overengineering:
- No abstraction without a second concrete use case.
- No config option without a user who needs it.
- No "future-proofing" that adds indirection today.

## Independence rule

The reviewer must not be the agent that authored the patch. If no independent reviewer is available, report the gate as blocked — do not self-approve.
