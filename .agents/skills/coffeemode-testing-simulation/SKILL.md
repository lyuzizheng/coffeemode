---
name: coffeemode-testing-simulation
description: Design and run CoffeeMode deterministic tests and simulated user/data flows. Use when the user asks for testing, QA, simulation, fixtures, flow validation, or regression coverage.
---

# CoffeeMode Testing Simulation

## Flow

Run `.agents/workflows/testing.md` and the canonical testing policy in `docs/specs/0003-testing-and-ci.md`.

The stack is Vitest + React Testing Library for unit/component, Playwright for flows, and `tsc --noEmit` as the type gate. Prefer deterministic fixtures (Neon test database, mocked POI-service responses, fixture images for the upload pipeline) over live external calls. Record product ambiguity as an unresolved design item, not an invented assertion.
