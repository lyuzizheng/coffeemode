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

## Harmonization notes

- 2026-09-18 (BRAWUKA-473): artifact token references harmonized to shipped
  code and the spec's new density invariants (spec 0002 §Spacing and
  radius): segmented-control track `radius-md` (concentric rule), fact
  chips `4px/10px` padding, PEEK cover `--layout-card-cover-w` (96px),
  preferences card `rounded-md`, gone-cafe title `text-2xl`, drawer close
  44px. Where an artifact and the spec disagree, the spec wins.

## Artifacts

| Slice | Artifact | Status | Issue |
| --- | --- | --- | --- |
| discovery-sheet | `discovery-sheet-v1.md` | Approved — owner, 2026-08-23 (DG21–DG43) | #133 |
| search-filters | `search-filters-v1.md` | Approved — owner, 2026-08-23 (DG44–DG58) | #135 |
| checkin-system | `checkin-system-v1.md` | Approved — owner, 2026-08-23 (DG59–DG75) | #148 |
| navigation-prompt | `navigation-prompt-v1.md` | Approved — owner, 2026-08-23 (DG76–DG93) | #149 |
| profile-page | `profile-page-v1.md` | Approved — owner, 2026-08-23 (DG94–DG103) | #152 |
| seo-sharing | `seo-sharing-v1.md` | Approved — owner, 2026-08-23 (DG104–DG113) | #150 |
| onboarding | `onboarding-v1.md` | Approved — owner, 2026-08-23 (DG114–DG123) | #153 |
