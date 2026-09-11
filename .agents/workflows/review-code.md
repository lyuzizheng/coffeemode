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

## Review authority

The reviewer MUST NOT be the agent that authored the patch, and an author NEVER
approves its own change.

Reviewer of record, in order:

1. The designated reviewer agent for this repository (the agent holding the
   `coffeemode-code-review` skill), when it did not author the patch.
2. If that agent is unavailable — provider outage, quota exhaustion, or it
   authored the patch — the workspace reviewer-of-record agent takes the gate.
   The substitute is still a non-author. Substituting the reviewer NEVER waives
   a check: every gate below applies unchanged.
3. If neither is available, report the gate as blocked. Do not self-approve.

A substitute reviewer MUST record on the issue thread:

- which reviewer was unavailable and why (the observed error, not a guess);
- whether it authored the fix design under review — the workspace coordinator
  often specifies the fix, so say so plainly rather than implying distance that
  does not exist;
- the evidence it verified itself: commands run with their output, files read,
  and the specific claims checked against the code rather than the PR body.

A verdict that only restates the author's summary is not a review. Independence
is about the agent, not the tooling: re-run the check you rely on instead of
trusting a green CI dot, and when the reviewer supplied the fix design, prove
the result by execution (reproduction, reverse test, or measurement) — never by
affirming the design.

Deliver the review verdict (`Review verdict: APPROVED` / findings) as a comment on the issue thread, providing the gate evidence and cumulative diff audit per closed-loop Step 7. Do not call `gh pr review --approve` on GitHub: workspace agents share the repository owner credentials, and GitHub rejects PR self-approval.
