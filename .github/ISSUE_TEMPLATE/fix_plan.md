---
name: Fix / Implementation Plan
about: Implementation-ready fix plan drafted from a bug, feature request, or review finding. Intended to be posted as a comment on the parent issue; omit the YAML frontmatter when using it as a comment.
title: "[PLAN] "
labels: []
assignees: []
---

## Parent issue / trigger

- Triggered by: # (bug report, review finding, or user request)

## Problem summary

One or two sentences describing the problem or gap.

## Root cause / diagnosis

What was found during issue review. Include relevant code references (`file:line`) and spec/ADR links.

## Fix plan

- **Slice ID** (from `docs/agent/implementation-slices.md`; register a new row if needed):
- **Affected files/packages**:
- **Schema/migration impact**:
- **API/service/UI impact**:
- **Test strategy**:
- **Required doc/spec/ADR updates**:
- **Risk tier**: Fast / Standard / High

## Verification checklist

- [ ] Focused deterministic checks pass (typecheck, lint, tests, build, preflight)
- [ ] Independent code review (for Standard/High risk)
- [ ] Independent semantic review (if docs/harness changed)

## Residual questions

Anything that still needs user, product, or design decision before implementation starts.
