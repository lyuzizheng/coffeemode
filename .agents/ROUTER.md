# Agent Router

Choose by intent, not keyword matching. Each intent has one skill (the
auto-invocable entry point) and, where applicable, the workflow it runs (the
detailed loop). Trigger the skill; it delegates to the workflow.

| Intent | Skill (entry) | Workflow (loop) |
| --- | --- | --- |
| Take a feature/fix from idea to merged PR (closed loop), 实现, 修复 | [implementation-cycle](./skills/coffeemode-implementation-cycle/SKILL.md) | [closed-loop](./workflows/closed-loop.md) |
| File an issue, report a bug, 提交 issue, 报告 bug | [issue-submission](./skills/coffeemode-issue-submission/SKILL.md) | [closed-loop](./workflows/closed-loop.md) |
| Pick up / triage / fix an existing GitHub issue, 处理 issue | [issue-review-fix](./skills/coffeemode-issue-review-fix/SKILL.md) | [closed-loop](./workflows/closed-loop.md) |
| Review, audit a change, 审查, 评估 | [code-review](./skills/coffeemode-code-review/SKILL.md) | [review-code](./workflows/review-code.md) |
| Design, UI, visual, 设计, 界面 | [ui-quality](./skills/coffeemode-ui-quality/SKILL.md) | [refine-ui](./workflows/refine-ui.md) |
| Test, QA, 测试 | [testing-simulation](./skills/coffeemode-testing-simulation/SKILL.md) | [testing](./workflows/testing.md) |
| Grill, align, stress-test, 对齐, 拷问 | [design-grill](./skills/coffeemode-design-grill/SKILL.md) | [design-grill](./workflows/design-grill.md) |
| Architecture, structure, boundaries, 架构, 重构 | [architecture-refinement](./skills/coffeemode-architecture-refinement/SKILL.md) | [refine-architecture](./workflows/refine-architecture.md) |
| Orientation, status, plan, resolve doc conflicts, 进度 | [docs-orientation](./skills/coffeemode-docs-orientation/SKILL.md) | [agent-system](./README.md) |

Trigger boundary: `implementation-cycle` owns the full idea→PR loop and finds or
files the issue itself; `issue-review-fix` starts from an issue that already
exists. When in doubt with a `#N` in hand, use `issue-review-fix`.

For mixed intents, resolve the earliest blocker first. Unknown intent defaults to orientation, never implementation.
