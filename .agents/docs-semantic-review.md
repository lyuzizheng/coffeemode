# Independent Docs Semantic Review

Use this gate after deterministic checks when a change touches `docs/`, `.agents/`,
`.codex/`, root `AGENTS.md`, agent/tool adapters, or CI/harness authority.

The reviewer must not be the agent that authored the patch. If no independent reviewer is available, the semantic gate cannot return `pass`; report the gate as blocked.

## Inputs

1. The exact user request that authorized the patch.
2. The author's stated assumptions, scope boundary, and success criteria.
3. `docs/STRUCTURE.md` and `docs/agent/current-state.md`.
4. Changed files and diff from `.agents/scripts/docs-review-packet.sh <base>`.
5. Task-relevant canonical specs.

The author must include inputs 1 and 2 in the reviewer handoff; the packet cannot infer authorization. If missing context prevents the reviewer from deciding whether the patch silently broadened scope, return `needs_design`.

## Judge checks

- One decision has one canonical owner.
- Summary, progress, alignment, and harness files do not override or duplicate product truth.
- New specs are indexed and old or placeholder specs are removed.
- Stable, partial, unresolved, and blocked language matches the actual decision state.
- The patch does not silently decide product, security, privacy, or irreversible data questions.
- Implementation guidance is safe enough to execute, or an explicit implementation blocker is present.
- Current navigation, terminology, workflow, and priority claims do not conflict.
- Deleted files have no remaining actionable references.

## Required output

```text
verdict: pass | fail | needs_design

findings:
- severity: P0 | P1 | P2
  evidence: file and line
  issue: concrete contradiction or risk
  action: mechanical fix or question for the user

residual_risk:
- anything deterministic checks cannot prove
```

Severity:

```text
P0  can corrupt authority, data safety, or the harness gate itself
P1  can cause incorrect implementation, material drift, or a false pass
P2  clarity, maintainability, or non-blocking residual risk
```

Verdict precedence:

```text
fail          any mechanically actionable P0/P1 remains
needs_design  blocking P0/P1 requires user judgment and no mechanical P0/P1 remains
pass          only P2 findings or no findings remain
```

The reviewer must not invent the answer to a `needs_design` finding.
