# Testing

Use this workflow for testing and QA tasks. `docs/specs/0003-testing-and-ci.md`
owns the test layers and path-to-gate policy.

## Loop

1. Run preflight and read the affected contract.
2. Identify the changed boundary and select the narrowest proving test.
3. For bugs, make the test fail on the reproduced defect before relying on it as a
   regression test.
4. Run the focused test and the relevant package gate.
5. Use the real-Postgres suite for migrations, SQL, triggers, or DB-backed flows;
   unit mocks do not satisfy that boundary.
6. Use browser/manual evidence for user-visible behavior. Automated visual
   comparison remains optional and non-blocking until a canonical baseline policy
   is accepted.
7. Report exact commands, expected/actual behavior, and residual gaps. A tester
   does not patch production code unless the root task explicitly assigns test
   authoring.

Local real-DB startup and commands live in `docs/agent/local-dev-stack.md`.
