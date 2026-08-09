# Documentation Structure

## Goal

Keep CoffeeMode's documentation small, canonical, and readable by AI coding agents without duplicate product truth.

## Folder contract

```text
docs/
  README.md
  STRUCTURE.md
  specs/
  adr/
  agent/
```

## What belongs where

### `docs/specs/`

Canonical implementation-grade product and technical specs.

Use specs for:

```text
feature behavior
business logic
data model decisions
UI behavior and design system
API contracts
testing and build expectations
migration plans
```

If something will guide implementation, it belongs in `docs/specs/`.

### `docs/adr/`

Architecture Decision Records.

Use ADRs for architecture decisions with historical context, such as choosing Next.js over Vite SPA or selecting a map provider.

An ADR's `Status` controls its authority. `Proposed` is not the same as `Accepted`.

### `docs/agent/`

AI coding agent memory and workflow.

Use it for:

```text
current state
reading order
issue-guidelines
implementation slices
progress log
```

This folder points to specs. It should not become a second product spec layer.

### `.agents/`

Repo-local agent operating material.

Use it for:

```text
intent routing
workflow checklists
deterministic helper scripts
```

The `.agents/` folder describes how agents work. It must point back to `docs/specs/` for product truth and must not duplicate canonical implementation decisions.

## Source contract

Authority is concern-based, not a total order:

| Concern | Authoritative source |
| --- | --- |
| User direction for the active task | User's latest explicit instruction |
| Intended product and implementation behavior | `docs/specs/*.md` |
| Architecture decision and rationale | `docs/adr/*.md`, per each ADR's status |
| Current implemented behavior | Code and tests |
| Current phase, focus, and known state | `docs/agent/current-state.md` |
| Agent procedure | `AGENTS.md` and `.agents/` |

## Conflict protocol

When sources disagree:

```text
1. Do not silently choose a convenient source.
2. Identify whether the conflict is intended behavior, current behavior, or unresolved design.
3. If the user's active instruction resolves it, update every stale projection in the same change.
4. If it needs product or design judgment, ask the user.
5. Run deterministic checks before finishing.
```

## Anti-duplication rule

A decision should have one canonical home. Other files may link to the canonical spec but should not restate the full decision.
