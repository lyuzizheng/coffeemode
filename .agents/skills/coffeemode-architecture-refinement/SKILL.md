---
name: coffeemode-architecture-refinement
description: Refine CoffeeMode code structure and module boundaries without speculative abstraction. Use when improving architecture, module boundaries, repo structure, or maintainability.
---

# CoffeeMode Architecture Refinement

## Workflow

Run `.agents/workflows/refine-architecture.md` if present, otherwise follow the loop in `.agents/workflows/development-cycle.md` at the High tier. Read `docs/adr/` (status-bearing) and task-relevant specs first; the current single-package `web/` layout and the split data layer (self-hosted Postgres for app data, Supabase Auth only, Workers+D1+KV for POI cache) are accepted decisions — challenge them only with new evidence, and record any change as a new ADR.
