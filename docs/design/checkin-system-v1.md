# Check-in System — Design Artifact v1

- Slice: `checkin-system` (issue #148)
- Status: **Approved — owner, 2026-08-23 (DG59–DG75)**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-21 — grill round 11 rulings DG59–DG73;
  2026-08-22 — copy tone sweep per DG87/DG93)
- Base: stacked on `docs/design/discovery-sheet-v1.md` and
  `docs/design/search-filters-v1.md` (icon set, control language, task-surface
  pattern are shared)
- Specs: `docs/specs/0001-nextjs-migration.md` §Check-in system, §Cafe
  creation flow; `docs/specs/0002-design-system.md` (components, signature
  moments); `docs/specs/0004-product-decisions-and-backlog.md` §7–§13

Scope: composition of the check-in drawer, slider/chip/photo controls, repeat
flow, and the success moment. Behavior (`overall` slider required per
check-in (DG40), unmoved slider not
recorded, `unknown` as first-class answer, soft delete, photo merge into
gallery, recency weighting) is canonical in the specs and is referenced, not
redefined.

---

## 1. Design intent

A check-in is data entry for a person holding a coffee in one hand. The
drawer must be completable in under 30 seconds with a thumb. Two rules
follow:

- **Everything optional except one honest signal** (spec: the `overall`
  slider is required per check-in, DG40; every other control optional). The
  drawer never demands completeness; it rewards any input.
- **Unset must look unset.** An unmoved slider records nothing (spec Q59), so
  the UI must never show a parked thumb as if it were a score of 50. This is
  the anti-vibe-coding core of this slice: no fake defaults.

## 2. Drawer surface

- **Mobile**: HeroUI Drawer, placement bottom, content-height detent, 92% max
  height, `radius-lg` top, `overlay` surface. Two detents (DG70): it opens at
  content height and can be dragged up to the 92% full-height detent (tall
  content — staged photos, edit mode — gets room; scrolling inside works at
  either detent). It opens **above the discovery
  sheet** (spec 0002 layout) — the discovery sheet dims to 60% and is
  inert while the drawer is open. Modal task surface, same a11y treatment as
  the search filter panel (`role="dialog"`, focus containment, `Esc`/scrim
  close, focus returns to the Check in button). The drawer pads its footer
  (confirm button) by `env(safe-area-inset-bottom)` and sizes detents in
  `dvh` per the spec 0002 viewport contract (DG75).
- **Desktop**: Drawer placement right, 420px, same content, single column.
- Header: cafe name only (`font-display`, `text-lg`, truncated) plus a 36px
  ghost close (×) top-right. No `Check in` title — the confirm button at the
  foot already says it. When the drawer is opened from the navigation
  prompt, a warm caption sits under the cafe name: `来打个卡，帮其他 nomad
  种草避雷吧！` (`text-xs`, `muted`; DG92).

## 3. Controls (top to bottom, 16px side padding, 16px section rhythm)

### 3.1 Repeat banner (only when a previous check-in exists)

Spec-mandated "Same as last time?" flow, composed as a compact card at the
top: `surface-secondary`, `radius-md`, 12px padding. One line:
`Last visit 12 Aug` (`text-sm`) + `Same` (outline `accent` button) +
`New` (ghost). Choosing `Same` pre-fills every previously-set slider and
policy (all become "set" states, user adjusts what changed); choosing `New`
(or dismissing via ×) leaves everything unset. The banner collapses after a
choice with a 200ms height animation. Offered only when the last check-in is
**<90 days old** (DG63) — a year-old "same" is not information.

### 3.2 Dimension sliders

Reuse the themed `ScoreSlider` primitive from `web/app/theme-preview/shared.tsx`
(label + mono tabular accent output + track/fill/thumb) with these refinements:

- Order: wifi, outlets, seats, temperature, coffee — then **overall last**,
  visually set apart: 1px `separator` above it, label `Overall experience`
  (`text-sm`, `foreground` instead of `muted`). Overall feeds the Experience
  score; the five dimensions feed the Work composite — the layout teaches
  that split without a word of explanation.
- Values are continuous integers 0–100 (no snapped steps, DG60).
- **Temperature is bidirectional** (DG73): its scale reads too cold ↔ too
  hot with the ideal at the midpoint, so its row carries endpoint captions —
  snowflake line glyph + `Too cold` at the left end, flame line glyph +
  `Too hot` at the right (`text-xs`, `muted`; glyphs from the discovery
  icon set, no emoji). The other four dimensions stay uncaptioned bad→good.
- **Unset state**: track `surface-tertiary`, **no fill**, thumb parked at the
  left edge at 50% opacity, output shows `—` (`muted`, mono). No number
  exists until the user touches the slider.
- **Set state**: first touch snaps the thumb to the touch point, fill renders
  in `accent`, output flips to the live value (`tnum`, `accent`), thumb does
  the haptic-style 1.15 scale pulse (120ms, spec 0002 signature moment) plus
  the weakest device vibration (`navigator.vibrate(10)`, DG69 — silently
  ignored where unsupported, e.g. iOS Safari).
- Clearing back to unset while composing is not offered — moving a slider is
  a deliberate act; leaving the whole check-in unsubmitted is the undo. In
  **edit mode**, a set slider row carries a small × (16px, `muted` → `danger`
  on hover) that returns it to unset, removing a previously recorded
  dimension from the check-in. (Owner decision, 2026-08-21 — DG26.)
- Slider rows are 56px tall (thumb ≥44px touch target), 12px gaps.

### 3.3 Policy chips

One `PolicyChips` single-select group (existing themed pattern):
`Max stay` (`unlimited | 3h | 2h | 1h | peak | unknown`) — values per spec,
with `unknown` rendered as a full chip equal to the others (honest data is
first-class, spec 0001). (The `Min spend` group was removed 2026-08-25 —
DG125.) Chip: `radius-sm`, 36px height, `surface-secondary`
idle, selected = `surface` + 1px `accent` border + `accent` text,
`aria-pressed` toggle semantics. Nothing selected by default.

### 3.4 Note

Autosizing textarea, 2–5 visible rows, `surface` background, `radius-md`,
`text-base`. Placeholder: `What should the next nomad know?` — one line of
guidance, no character counter, no formatting toolbar. Hard cap **500
chars** (DG67; paste/type is truncated at the cap, no error chrome). Label
`Note (optional)` as a `text-xs` `muted` caption above the field, not
floating chrome.

### 3.5 Photos

Optional in this drawer (the ≥1-photo requirement belongs to the creation
flow, `cafe-creation` slice). A horizontal thumbnail row: 72px squares,
`radius-md`; first tile is the add tile (dashed 1px `border`, `muted` `+`
glyph, `text-xs` `Add photos`). Max **6 photos** per check-in (DG68) — the
add tile disappears at the cap. Selected photos get a 20px ×-badge top-right
(`overlay` circle, `danger` glyph). **Upload starts on selection** (DG59):
each tile shows its image immediately under a 40%-black scrim with a 2px
`accent` progress bar along its bottom edge while the presigned PUT runs —
the user keeps composing, submit is instant when uploads have finished (no
spinners, spec 0002); failures get a `danger` 1px border + tap-to-retry.
Upload requires auth (spec 0001: presigned URLs are issued to authenticated
sessions only) — a logged-out composer stages photos locally and they upload
after the sign-in gate (§3.6). The 10 MB cap is
communicated only on violation (toast), not as static fine print.

### 3.6 Confirm

Full-width solid `accent` button, 48px, `radius-sm`, label `Check in`
(creation variant in the creation slice reads `Add to CoffeeMode ✓` per
spec). Disabled with a `text-xs` `muted` hint `Set Overall experience to
check in` beneath it until the required overall slider is set (DG40).

**Sign-in gate (DG66)**: composing works logged-out, but publishing requires
an account. Tapping `Check in` while logged out opens the sign-in sheet
offering all configured providers (Apple + Google, per spec 0001 auth);
after sign-in the pending check-in publishes with its locally staged input
(photos upload at that point, §3.5) — no re-entry.

**Idempotency (DG61)**: each drawer open generates a UUID sent with the
mutation; the server dedupes on it, so a retry after a flaky connection can
never double-record. Invisible in the UI.

## 4. The success moment (spec-delegated detail)

Spec 0002 mandates: button morphs to ✓ + micro coffee-steam animation +
toast, restrained, no confetti. Composition:

1. On successful save, the confirm button's label crossfades (120ms) to a ✓
   glyph that draws itself in via stroke (200ms, `ease.default`); the button
   background eases `accent` → `secondary` (sage) over 200ms.
2. Drawer content swaps to a compact success card: centered 24px cup-outline
   glyph (the §2 discovery icon-set cup) with **two 1.5px steam strokes**
   that rise 6px and fade, 450ms total, played once, 80ms stagger between
   them — line-art steam, same stroke language as the icon set, no particles.
   Below it: `Checked in` (`text-lg`, body font at medium weight — the display
   font stays reserved for page titles and cafe names, spec 0002 typography
   rules) and the submitted dimension values as mini
   WorkBars animating in (300ms, 40ms stagger — the WorkProfile rhyme).
3. The card holds 900ms, then the drawer closes (150ms exit, faster out than
   in) and a HeroUI toast confirms: `Check-in saved` with the ✓ glyph.
4. Reduced motion: the morph and steam are skipped entirely — toast only.
   The whole sequence is decorative; state is already saved at step 1.

## 5. Edit and soft delete

Editing reuses this exact drawer, pre-filled (with per-slider unset × per
§3.2), titled by the same cafe name, confirm label `Save changes`. Edit
entry points (DG72): the overflow menu on your own check-in feed cards, the
check-in history list on the profile page, and an `Edit your check-in` row
on the cafe detail when you have a live check-in there. Editing updates
values only — recency weighting always keys off the original `visited_at`,
so editing can never launder freshness (DG62). Delete lives behind a
`Delete check-in`
`danger` text-button at the drawer's foot (edit mode only), guarded by a
HeroUI confirmation popover (`Delete? This removes your scores.` /
`Cancel` / `Delete`). No swipe-to-delete gestures anywhere.

## 6. States

- **Submit in flight**: confirm button label → `Saving…`, button disabled at
  60% opacity (no spinner); controls stay frozen but visible.
- **Submit failure**: inline row above the confirm button — warning glyph +
  `Couldn't save your check-in` + outline `Retry`. All input preserved
  exactly.
- **Offline**: the global OfflineBanner plus a disabled confirm button.
  Spec 0001 has no offline mutation queue; creation is explicitly disabled
  offline (spec 0004 §18), and this drawer applies the same no-queue rule to
  check-in mutations. (Owner decision, 2026-08-21 — DG27.)
- **Validation**: the only rule is the required `overall` slider (DG40); it
  is handled by the disabled
  state + hint (§3.6), never by an error toast after the fact.
- **Same-day revisit (DG64)**: the 1-per-cafe-per-24h limit is product
  behavior, not an error — if you already have a live check-in at this cafe
  from the last 24h, the Check-in entry point opens this drawer in **edit
  mode** on that check-in instead of composing a new one. The user never
  sees a 429 for this.
- **Drawer dismissed with input**: "dirty" means the drawer's state differs
  from its opening state — in edit mode the pre-filled values are the
  baseline, so closing an untouched edit drawer never prompts. If dirty,
  dismissal pauses on a HeroUI
  confirmation: `Discard this check-in?` with `Keep editing` (ghost) and
  `Discard` (`danger` text-button). A pristine drawer closes immediately —
  the confirm appears only when there is something to lose. Draft
  persistence remains a V2 candidate. (Owner decision, 2026-08-21 — DG21.)

## 7. Motion, dark mode, accessibility, i18n

- Timings per spec 0002; assignments above. Drawer spring `ease.spring`
  restrained; reduced motion → instant state changes, toast-only success.
- Token-only colors; photos never dimmed in dark mode.
- Sliders expose `aria-label` + live `aria-valuenow` once set; the unset
  state announces `not set`. Chips use `aria-pressed`. The success swap sets
  `aria-live="polite"` so screen readers hear `Check-in saved` from the
  toast, not the animation.
- Keys under `checkIn.*` (en/zh). zh references: `Check in` → `打卡`,
  `Same` / `New` → `和上次一样` / `重新评价`, `Overall experience` →
  `整体体验`, `Set Overall experience to check in` → `先给整体体验打个分吧`,
  `What should the next nomad know?` → `下一位 nomad 该知道什么？`,
  `Couldn't save your check-in` → `没保存成功，再试试？`,
  `Check-in saved` → `打卡成功，谢谢分享！`,
  `Discard this check-in?` → `放弃这次打卡？`, `Keep editing` → `继续编辑`,
  `Discard` → `放弃`, `Too cold` / `Too hot` → `太冷` / `太热`,
  `Edit your check-in` → `修改我的打卡`.

## 8. Visual acceptance criteria (owner sign-off)

- [ ] Unset sliders are unmistakably unset (no fill, `—` output, parked
      thumb) — zero fake-default feel.
- [ ] Overall reads as the summary of the five dimensions, not a sixth peer.
- [ ] The steam moment is memorable and line-art restrained — no confetti,
      no particles, no emoji.
- [ ] Drawer completes one-handed on a 390px-wide phone.
- [ ] Repeat banner pre-fills honestly and collapses without layout jump.
- [ ] Dirty-dismiss confirm (`Discard this check-in?`) appears only when
      input exists; pristine drawer closes instantly.
- [ ] Dark mode requires no per-component overrides.
- [ ] Temperature row carries the `Too cold` / `Too hot` endpoint captions;
      the other four dimensions stay uncaptioned (DG73).
- [ ] Photo tiles show image + scrim + progress bar during upload; composing
      is never blocked by an in-flight upload (DG59).
- [ ] The add tile disappears at 6 photos (DG68).
- [ ] Logged-out `Check in` opens the provider sign-in sheet and publishes
      the staged draft after sign-in — no re-entry (DG66).
- [ ] A same-day revisit opens the drawer in edit mode on the existing
      check-in, never an error (DG64).
- [ ] The drawer drags from content-height to the 92% detent and back
      without losing scroll position (DG70).

## Out of scope (other slices)

Creation-specific requirements (≥1 photo, link import, dedupe prompt) —
`cafe-creation`; the navigation-triggered prompt that opens this drawer —
`navigation-prompt`; WorkProfile display of the aggregated result —
`discovery-sheet` FULL; check-in feed cards — `discovery-sheet` §5.3.
