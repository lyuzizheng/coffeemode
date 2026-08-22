# Navigation Prompt — Design Artifact v1

- Slice: `navigation-prompt` (issue #149)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-22 — grill round 12 rulings DG76–DG90;
  queue semantics + final copy per DG91/DG92)
- Base: `docs/design/discovery-sheet-v1.md`, `docs/design/checkin-system-v1.md`
  (icon set, task-surface pattern, success toast are shared)
- Specs: `docs/specs/0001-nextjs-migration.md` §Check-in system (navigation →
  check-in prompt), §Auth (anonymous sessions); `docs/specs/0002-design-system.md`
  (`NavPrompt` component, signature moments, copy tone)

Scope: composition of the return-visit prompt card and its collapsed pill.
Behavior (record navigation on Navigate tap including anonymous sessions,
prompt earliest the next day, 3-month expiry, one-per-session queue,
three-option resolution, outcome storage) is canonical in spec 0001 and is
referenced, not redefined.

---

## 1. Design intent

The prompt is a friendly tap on the shoulder, not a banner ad. A person who
navigated to a cafe yesterday gets asked — warmly, once — whether they made
it, because their answer becomes data that helps the next nomad. Two rules
follow:

- **It asks like a friend** (spec 0002 copy tone, DG87): 热情真诚, cute,
  zero commercial pressure. No guilt, no urgency, no "don't forget!".
- **Every exit is honest.** Three real choices — visited / not yet / won't
  go — and no × button pretending to be neutral (DG81).

## 2. The card

Bottom slide-up card, rendered **above the discovery sheet** (12px gap) on
mobile and floating bottom-center over the map (360px width) on desktop
(DG84):

- Surface `overlay`, `radius-lg`, `shadow-lg` warm tint, 1px `border`;
  bottom padding includes `env(safe-area-inset-bottom)` (DG75).
- Layout: single row. Left: **48px cover thumbnail** (`radius-md`, 4:3 crop;
  `surface-tertiary` + cup glyph fallback for coverless cafes) — the user
  recognizes the place instantly (DG86). Middle, two lines: the headline
  `有去 {cafe} 喝一杯吗？` (`text-sm`, `foreground`, name truncated) and the
  context line `你{day}还导航来了这里` (`text-xs`, `muted`). **No × button
  anywhere** — the three options are the only exits (DG81).
- Option row below, full width, 8px gap, three buttons:
  - `有去！` — solid `accent`, flex-1. Opens the check-in drawer
    (checkin-system-v1) targeted at that cafe; the drawer header carries
    the warm caption `来打个卡，帮其他 nomad 种草避雷吧！` when entered
    from this prompt (DG92) — the contribution framing lives there, not as
    pressure copy on this card.
  - `还没去` — ghost. Closes the card; the item goes to the **back of the
    queue** and becomes eligible again after ≥ 1 day (max 2 re-asks, then
    auto-resolves; DG91).
  - `不去了` — `muted` text-button. Permanently resolves the navigation
    (outcome `wont_go`), no confirmation, no guilt copy.
- All three answers resolve the prompt. The card never reappears for the
  same navigation in the same session regardless of choice.

## 3. Auto-collapse to pill

After 8s untouched (spec-owned timing), the card morphs into a pill —
Framer `layoutId` shared-element transition, 200ms `ease.default`:

- Pill: bottom-right, above the sheet/FAB safe zone; `overlay` surface,
  `radius-full`, `shadow-map`, 36px height: navigation glyph + `有去喝一杯吗？`
  (`text-xs`). No × on the pill either — tapping it re-expands the card
  (same `layoutId` morph) where the three options live.
- The pill **stays until answered** (DG88) — it is 36px tall and off the
  action path; a second timeout would silently lose the funnel data.
- The pill never covers the FAB: stacked above it with a 12px gap.
- Interacting with the card (hover/focus/touch-hold) pauses the 8s timer —
  a user mid-read never loses the actions (DG28).

## 4. Motion and reduced motion

- Enter: 300ms slide-up `ease.default` + 8px fade. Exit: 150ms slide-down.
- Card ↔ pill morph: 200ms. All springs restrained (spec 0002).
- **No sound, no haptic** on entry (DG89) — a polite interruption doesn't
  buzz.
- Reduced motion: card appears/disappears instantly; the 8s auto-collapse
  still happens (it is a state change, not animation).

## 5. States and edges

- **Timing**: the prompt renders earliest the **next day** after the
  navigation (DG78) — never same-day, never immediately.
- **Fetch**: the unresolved-navigation lookup is a lazy query fired after
  the map reaches idle (DG77) — never on the critical render path.
- **Defer, never stack**: the prompt waits while the discovery sheet is at
  FULL (DG85) and while any modal task surface is open — check-in drawer,
  filter panel, sign-in sheet (DG90). It renders once the UI returns to
  PEEK/HALF with no modal open.
- **Queue (DG91)**: all promptable items live in a generic per-user
  prompt-queue service (`web/lib/prompt-queue` — built as a reusable service
  component for future prompt features, not nav logic coupled into this
  card). One prompt per session, most recent eligible first. `还没去`
  sends the item to the **back of the queue**, stamps `last_asked_at`, and
  it becomes eligible again only after ≥ 1 day; an item dequeued at an
  ineligible moment is re-queued, never dropped. Max 2 re-asks
  (`ask_count ≤ 2`), then it auto-resolves.
- **Expiry**: navigations older than 3 months never prompt (DG83).
- **Anonymous users**: the prompt works for anonymous sessions (Supabase
  anonymous sign-in, DG76); upgrading to Apple/Google keeps the history.
- **Auto-resolve**: any check-in at that cafe — from any entry point —
  silently resolves the pending navigation with outcome `auto` (DG79); the
  prompt then never renders.
- **Check-in completed from the prompt**: drawer closes per checkin-system-v1
  §4; the prompt is already resolved (`visited`) and gone — no second toast
  beyond the check-in success toast.
- **Cafe missing at prompt time**: the prompt simply never renders (the
  unresolved-navigation record pointing at a deleted cafe resolves silently);
  no error UI for a prompt the user never asked for.
- **Offline**: the prompt can render from local state, but `有去！`
  follows the check-in drawer's offline-disabled treatment
  (checkin-system-v1 §6).

## 6. Accessibility and i18n

- The card is `role="status"` content with real buttons — it does not steal
  focus on entry; screen readers announce it via `aria-live="polite"`. Focus
  moves only if the user tabs to it. Any choice moves focus back to the map.
- Timer pause on focus satisfies keyboard users; the three options are the
  full tab order (no ×).
- Keys under `navPrompt.*`. Copy follows the spec 0002 tone principle
  (DG87 — 热情真诚, cute, non-commercial). zh/en reference pairs:
  - Headline: `有去 {cafe} 喝一杯吗？` / `Grabbed a coffee at {cafe}?`
  - Context line: `你{day}还导航来了这里` / `You navigated here {day}`
  - Options: `有去！` / `I did!` ·
    `还没去` / `Not yet` · `不去了` / `Won't go`
  - Check-in drawer caption (entered from this prompt):
    `来打个卡，帮其他 nomad 种草避雷吧！` /
    `Check in — help fellow nomads find the gems and dodge the duds!`
  - Pill: `有去喝一杯吗？` / `Grab that coffee?`

## 7. Visual acceptance criteria (owner sign-off)

- [ ] Card reads in under two seconds: where, question, three honest options.
- [ ] The cover thumbnail makes the cafe instantly recognizable; coverless
      cafes get the cup-glyph fallback, never a broken image.
- [ ] No × button anywhere; `还没去` and `不去了` are visibly different
      weights (ghost vs muted text) so the primary action stays obvious.
- [ ] The pill is discoverable but ignorable; it never covers the FAB or the
      sheet handle, and it never disappears on its own.
- [ ] The card→pill morph feels like one element changing shape, not two
      elements swapping.
- [ ] Copy passes the DG87 tone check read aloud: warm, cute, zero sales.
- [ ] No emoji, no badge spam, no red-dot pressure patterns.
- [ ] Dark mode requires no per-component overrides.

## Out of scope

The check-in drawer itself (checkin-system-v1), the Navigate action's deep
links (spec-owned), navigation event recording (backend, API5), the
system-wide copy-tone sweep across other artifacts (DG87 follow-up).
