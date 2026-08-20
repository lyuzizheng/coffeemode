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
  design/
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

Current project state and implementation planning.

Use it for:

```text
current phase and blockers
implementation slices
pending owner actions
```

This folder points to specs. It should not become a second product spec layer.

### `docs/design/`

Versioned Kimi K3 visual-design artifacts, one per UI slice.

Use it for:

```text
slice-specific composition, hierarchy, iconography
responsive treatment, motion detail, visual states
owner approval records that unblock UI slices
```

Artifacts own visual composition only; product behavior stays canonical in
`docs/specs/`. See `docs/design/README.md` for the artifact contract.

### `.agents/`

Repo-local agent operating material.

Use it for:

```text
intent routing
coding and issue rules
closed-loop workflows
trigger-oriented skills
deterministic helper scripts
```

The `.agents/` folder is the single procedural home for how agents work. It must
point back to `docs/specs/` for product truth and must not duplicate canonical
implementation decisions.

## Source contract

Authority is concern-based, not a total order:

| Concern | Authoritative source |
| --- | --- |
| User direction for the active task | User's latest explicit instruction |
| Intended product and implementation behavior | `docs/specs/*.md` |
| Visual composition for a UI slice | `docs/design/*.md` (Kimi K3 artifact, once Approved) |
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
