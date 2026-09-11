## Issue

- Link: <!-- Fixes #N only if this PR fully satisfies the issue; otherwise Refs #N -->
- Fix plan: <!-- issue comment URL -->
- Stack: <!-- base and merge order, or none -->

## Context

<!-- What problem is solved and why this is the smallest complete change. -->

## Changes

- Affected area or planned slice:
- Behavior/API/schema/UI impact:
- Root cause and sibling sites checked:

## Structure

<!-- Canonical thresholds: docs/specs/0009-code-quality-and-module-boundaries.md §3. -->

- [ ] No file crossed a hard threshold (400 lines / 80 per function / complexity 15 / depth 4 / params 5) without being split in this PR.
- [ ] Touched oversize files were split in this PR, or a `[STRUCT-EXEMPT]` issue is linked and the ratchet entry updated (0009 §7).
- [ ] No duplicated logic added: 2nd occurrence extracted to a helper; repeated shape uses factory/composition (0009 §5). `npm run check:structure` passes.
- [ ] New abstraction (if any): pattern (Factory / Strategy / Adapter / Facade / DI) and rejected alternative stated below; more than one call site, or the 2nd implementation is named (0009 §6).
- Pattern/reason:
- Exemption registration:

## Verification

<!-- Exact relevant commands and results. Mark non-applicable gates explicitly. -->

```text

```

- [ ] Focused test proves the changed behavior.
- [ ] Relevant package gate passes.
- [ ] Real-Postgres gate passes if DB/SQL behavior changed.
- [ ] Preflight passes.
- [ ] Manual/browser evidence exists if user-visible behavior changed.
- [ ] Independent implementation review completed when required by the tier.
- [ ] Independent semantic review completed if docs/agent/CI authority changed.

## Risk and release

- Tier: <!-- Fast / Standard / High; see .agents/workflows/development-cycle.md -->
- Deployment, migration, environment, secret, or owner action:
- Residual risk or linked follow-up:

## Checklist

- [ ] The issue link uses `Fixes` only for complete acceptance criteria.
- [ ] Canonical specs changed only if behavior/contracts changed.
- [ ] Current state or an existing product slice changed only if phase/blockers/status changed.
- [ ] CI is green.
- [ ] Stack merge order is stated if applicable.
