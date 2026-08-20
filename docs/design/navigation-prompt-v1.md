# Navigation Prompt — Design Artifact v1

- Slice: `navigation-prompt` (issue #149)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21
- Base: `docs/design/discovery-sheet-v1.md`, `docs/design/checkin-system-v1.md`
  (icon set, task-surface pattern, success toast are shared)
- Specs: `docs/specs/0001-nextjs-migration.md` §Check-in system (navigation →
  check-in prompt); `docs/specs/0002-design-system.md` (`NavPrompt` component,
  signature moments)

Scope: composition of the return-visit prompt card and its collapsed pill.
Behavior (record navigation on Navigate tap, prompt on the next visit, >30min
threshold, max 1 prompt per session, unresolved-navigation trigger) is
canonical in spec 0001 and is referenced, not redefined.

---

## 1. Design intent

The prompt is a polite interruption: it must be noticeable enough to catch a
returning user and effortless to dismiss for one who didn't go. It borrows
the ClassPass pattern the spec names — a slide-up card that auto-collapses to
a pill — and stays visually subordinate to the discovery sheet.

## 2. The card

Bottom slide-up card, rendered **above the discovery sheet** (12px gap) on
mobile and floating bottom-center over the map (360px width) on desktop:

- Surface `overlay`, `radius-lg`, `shadow-lg` warm tint, 1px `border`.
- Layout: single row. Left: 36px `surface-secondary` tile with the
  navigation glyph (arrow-turn icon, 16px, `secondary` sage). Middle, two
  lines: `Did you visit {cafe name}?` (`text-sm`, `foreground`, name
  truncated) and `Your navigation from {day}` (`text-xs`, `muted`). Right:
  28px ghost × dismiss.
- Action row below, full width, 8px gap: `Check in ✓` (solid `accent`,
  flex-1) and `Didn't go` (ghost). ✓ is a drawn glyph from the check-in
  success language, not emoji.
- `Check in ✓` opens the check-in drawer (checkin-system-v1) targeted at
  that cafe. `Didn't go` and × both resolve the prompt without a check-in —
  no guilt copy, no confirmation.

## 3. Auto-collapse to pill

After 8s untouched (spec-owned timing), the card morphs into a pill —
Framer `layoutId` shared-element transition, 200ms `ease.default`:

- Pill: bottom-right, above the sheet/FAB safe zone; `overlay` surface,
  `radius-full` (a true pill control, allowed by the radius rules), `shadow-map`,
  36px height: navigation glyph + `Visited?` (`text-xs`) + 16px ×.
- Tapping the pill re-expands the card (same `layoutId` morph). The × on the
  pill dismisses without re-expanding.
- The pill never covers the FAB: stacked above it with a 12px gap.
- Interacting with the card (hover/focus/touch-hold) pauses the 8s timer —
  a user mid-read never loses the actions.

## 4. Motion and reduced motion

- Enter: 300ms slide-up `ease.default` + 8px fade. Exit: 150ms slide-down.
- Card ↔ pill morph: 200ms. All springs restrained (spec 0002).
- Reduced motion: card appears/disappears instantly; the 8s auto-collapse
  still happens (it is a state change, not animation).

## 5. States and edges

- **Check-in completed from the prompt**: drawer closes per checkin-system-v1
  §4; the prompt is already resolved and gone — no second toast beyond the
  check-in success toast.
- **Cafe missing at prompt time**: the prompt simply never renders (the
  unresolved-navigation record pointing at a deleted cafe resolves silently);
  no error UI for a prompt the user never asked for.
- **Session cap**: at most one prompt per session (spec); if several
  unresolved navigations exist, only the most recent composes a card.
- **Offline**: the prompt can render from local state, but `Check in ✓`
  follows the check-in drawer's offline-disabled treatment
  (checkin-system-v1 §6).

## 6. Accessibility and i18n

- The card is `role="status"` content with real buttons — it does not steal
  focus on entry; screen readers announce it via `aria-live="polite"`. Focus
  moves only if the user tabs to it. Dismiss moves focus back to the map.
- Timer pause on focus satisfies keyboard users; the × is reachable first in
  the card's tab order after the actions.
- Keys under `navPrompt.*`. zh references (spec-seeded): `Did you visit
  {cafe}?` → `你上次导航去了 {cafe}，去过了吗？`, `Check in ✓` → `打卡 ✓`,
  `Didn't go` → `没去`, `Visited?` → `去过了吗？`.

## 7. Visual acceptance criteria (owner sign-off)

- [ ] Card reads in under two seconds: where, question, two actions.
- [ ] The pill is discoverable but ignorable; it never covers the FAB or the
      sheet handle.
- [ ] The card→pill morph feels like one element changing shape, not two
      elements swapping.
- [ ] No emoji, no badge spam, no red-dot pressure patterns.
- [ ] Dark mode requires no per-component overrides.

## Out of scope

The check-in drawer itself (checkin-system-v1), the Navigate action's deep
links (spec-owned), navigation event recording (backend, API5).
