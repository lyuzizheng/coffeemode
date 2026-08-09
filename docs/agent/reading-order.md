# AI Agent Reading Order

Canonical reading path for AI coding agents entering the CoffeeMode repository.

## Default reading order

Before implementation, read in this order:

```text
1. docs/README.md
2. docs/STRUCTURE.md
3. docs/agent/current-state.md
4. docs/agent/issue-guidelines.md (when filing/triaging/fixing issues)
5. docs/specs/* relevant to the task
6. docs/adr/*.md relevant to the task
```

## App implementation context

Do not read all specs for one coding task.

```text
1. Select a slice from docs/agent/implementation-slices.md
2. Generate .agents/scripts/context-for-slice.sh <slice-id>
3. Obey the readiness gate: STOP blocks coding, READY permits it
4. Give implementation, testing, and review the same slice ID
```

Every session also follows `docs/agent/iteration-protocol.md`.

## Completion gate

A task is not done until:

```text
code behavior matches docs
relevant docs match code behavior
progress log is updated
no known conflicts remain in touched topics
preflight passes
```
