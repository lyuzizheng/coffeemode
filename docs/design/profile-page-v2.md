# Profile Page — Design Artifact v2 (amendment)

- Slice: `profile-page` (issue #152; amendment for BRAWUKA-363)
- Status: **Proposed — pending owner sign-off** (decision 6b)
- Author: Coffee FE Engineer & Designer, on audit by Reviewer & Architect
- Date: 2026-09-17
- Supersedes: `profile-page-v1.md` §2 (page composition) and §5 (anonymous
  gate). Every other section of v1 stands unchanged.

Reason for amendment: the DG136 ranking preference was added (BRAWUKA-24)
without a composition decision — it rendered mid-page for everyone and
inside the anonymous gate flow. Owner feedback (BRAWUKA-13 thread,
2026-09-17): the preference block belongs "at the end or in a settings
screen"; the page read as AI-vibe-coded. No `/settings` route exists and
three controls do not justify one (anti-overengineering), so settings
consolidate into a single Preferences section at the bottom of `/profile`.

## 1. Design intent (delta)

The authenticated page reads as **one axis: identity → data → settings**.
Controls never sandwich content; the gate carries no settings chrome.

## 2. Page composition (replaces v1 §2)

Centered column, 640px max width, 16px side padding (mobile) / 24px
(desktop). No map, no sheet — a dedicated content page.

1. **Hero header** — unchanged from v1 §2.1.
2. **Stats row** — same two stat blocks and count-up as v1 §2.2, but the
   chrome is a **hairline `border-y` strip** (centered, `max-w-xs`), not a
   rounded card — matching the loading skeleton and the quieter editorial
   language.
3. **Tabs** — unchanged from v1 §2.3.
4. **Preferences** — the last element on the page. A `text-sm font-medium
   muted` heading (`Preferences` / `偏好设置`) over one grouped card
   (`rounded-xl border bg-surface`) whose rows are separated by `divide-y
   divide-separator`:
   - **Public identity** switch row (moved here from between stats and
     tabs — spec 0006 Q1/Q7 control, unchanged behavior).
   - **Public handle** row (same control, same row).
   - **Search ranking** row — the DG136 `settings` variant (label +
     description + segmented control).

## 5. States (replaces v1 §5 anonymous bullet)

- **Anonymous session** (DG94): the gate renders the ≤8% cup-glyph
  watermark as the *only* graphic — no icon disc or other chrome — plus
  the display-font title `Your cafes live here` (`text-xl`), the
  data-preservation body (`text-sm`, `muted`), and both `SignInButton`s
  (Apple primary / Google outline). The **ranking preference moves to a
  true page footer** (`mt-auto`, `border-t border-separator`): a compact
  single-line presentation — muted label + segmented control inline, no
  description paragraph. DG136 is preserved: the control stays reachable
  without an account, but it no longer interrupts the sign-in flow.
- All other states (loading, empty, fetch failure, SEO/privacy) unchanged
  from v1 §5.

## 6. i18n (delta)

- New key `profile.preferences`: en `Preferences` / zh `偏好设置`.
- Reuses existing `search.ranking.*` and `profile.public_*` keys.

## 7. Visual acceptance criteria (delta)

- [ ] Anonymous visitors see a clean gate — watermark, title, body,
      sign-in buttons — with the ranking preference only in the page
      footer, outside the gate flow.
- [ ] Authenticated visitors find every setting in one Preferences
      section at the bottom of the page; nothing sits between stats and
      tabs or after tabs except that section.
- [ ] The stats strip matches its loading skeleton (hairline `border-y`).
