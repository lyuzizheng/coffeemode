<!--
PR Title Format (MANDATORY for Multica auto-linking):
<IDENTIFIER>: <PR Title>
Example: BRAWUKA-1: [#236] [ARCH] Decompose monolithic frontend components
-->

## Issue

- Multica Issue: <!-- Closes <IDENTIFIER> (e.g. Closes BRAWUKA-1) or Refs <IDENTIFIER> -->
- GitHub Issue: <!-- Fixes #N only if this PR fully satisfies the issue; otherwise Refs #N -->
- Fix plan: <!-- issue comment URL -->
- Stack: <!-- base and merge order, or none -->

## Context

<!-- What problem is solved and why this is the smallest complete change. -->

## Changes

- Affected area or planned slice:
- Behavior/API/schema/UI impact:
- Root cause and sibling sites checked:

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
