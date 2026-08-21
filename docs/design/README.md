# Design Artifacts

Kimi K3 is the visual-design authority for new user-visible UI
(`docs/specs/0004-product-decisions-and-backlog.md` §6a). This folder holds the
versioned, slice-specific design artifacts that gate UI implementation
(`docs/specs/0002-design-system.md` stable decisions).

## Contract

- One file per slice per version: `<slice>-v<N>.md`.
- Product behavior stays canonical in `docs/specs/`; an artifact owns only
  composition, hierarchy, iconography, responsive treatment, motion detail, and
  visual states. If an artifact contradicts a spec, the spec wins and the
  artifact must be revised.
- Status header: `Draft` (awaiting owner approval) or
  `Approved — <owner>, <date>`. Only `Approved` artifacts unblock a slice in
  `docs/agent/implementation-slices.md`.
- Approval and visual acceptance are recorded in the artifact header and linked
  from the slice's GitHub issue (see issue #141 acceptance criteria).
- Revisions bump the version (`-v2`) rather than rewriting history; superseded
  versions stay in place. Drafts may be revised in place; versions bump once
  Approved.

## Artifacts

| Slice | Artifact | Status | Issue |
| --- | --- | --- | --- |
| discovery-sheet | `discovery-sheet-v1.md` | Draft — pending owner approval | #133 |
| search-filters | `search-filters-v1.md` | Draft — pending owner approval | #135 |
| checkin-system | `checkin-system-v1.md` | Draft — pending owner approval | #148 |
| navigation-prompt | `navigation-prompt-v1.md` | Draft — pending owner approval | #149 |
| profile-page | `profile-page-v1.md` | Draft — pending owner approval | #152 |
| seo-sharing | `seo-sharing-v1.md` | Draft — pending owner approval | #150 |
| onboarding | `onboarding-v1.md` | Draft — pending owner approval | #153 |
