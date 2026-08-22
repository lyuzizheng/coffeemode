# Cafe Detail SSR & Sharing — Design Artifact v1

- Slice: `seo-sharing` (issue #150)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-22 — copy tone sweep per DG87/DG93)
- Base: `docs/design/discovery-sheet-v1.md` (FULL composition, icon set,
  score hierarchy are reused verbatim)
- Specs: `docs/specs/0001-nextjs-migration.md` §Rendering strategy
  (`/cafes/[id]` SSR), §Onboarding & city model (deep-link banner), §PWA &
  sharing; `docs/specs/0002-design-system.md` (`DeepLinkBanner` component);
  DG3, DG19 (route ownership, missing-cafe 404)

Scope: composition of the server-rendered `/cafes/[id]` page, the deep-link
banner, the share control, and the 404. Behavior (SSR route ownership,
one-push URL semantics, 404 contract, Web Share API primary / copy-link
fallback, og:image = cafe cover) is canonical in the specs and is referenced,
not redefined.

---

## 1. Design intent

This page is the product's handshake with the outside world: a link dropped
into a chat must open to something complete, fast, and honest — full content
for a first-time visitor, with a gentle path into the app. Content first,
never a full-screen interruption (spec).

## 2. Page composition

Server-rendered, centered 640px column, 16px/24px side padding, global
header. The body **is** the discovery FULL composition (discovery-sheet-v1
§5.3) rendered as a static page: title block, score pair (Work hero +
Experience), WorkProfile dimension bars with respondent counts, policy
consensus, gallery, and the check-in feed's first page (Helpful order — the
default mode; the Newest toggle on this page is a link to `?feed=newest`,
server-rendered, no client state required).

Differences from the in-app FULL, deliberate:

- The action row renders as `Check in` (solid accent, links to `/` with the
  cafe selected — the check-in drawer lives in the app), `Navigate`
  (outline sage, provider deep link per spec), and `Share` (ghost icon) —
  same trio, same order, same styling as discovery-sheet-v1 §4.
- Bars render at final width without animation (SSR page: no entry motion;
  reduced motion is the default here).

## 3. Deep-link banner (DeepLinkBanner)

First-visit only (spec-owned storage rules): a lightweight bottom banner,
never modal.

- Mobile: bottom-anchored bar, full width minus 16px margins, `overlay`
  surface, `radius-lg`, `shadow-map`, 1px `border`. One tappable row: 20px
  cup glyph (icon set), `CoffeeMode` (`text-sm`, medium weight), then
  `Open in CoffeeMode` (`text-sm`, `accent` text) as the action, and a 28px
  ghost × at the right edge.
- Desktop: same banner, 420px, bottom-center.
- Enter: 200ms gentle rise (spec signature moment), never blocking content;
  dismissal persists permanently via a `localStorage` flag in the spec's
  onboarding storage family — a dismissed banner that returns every session
  is nagging. (Owner decision, 2026-08-21 — DG29.)
- The banner yields layout: it overlays, it does not push content.

## 4. Share control

The `Share` ghost icon button (36px, share-node glyph) triggers the spec's
flow: Web Share API where available, copy-link fallback otherwise. Fallback
feedback is a HeroUI toast: `Link copied` with the ✓ glyph, 150ms in. No
share sheet of our own, no QR codes, no social buttons row at MVP.

OG/social card (spec-owned content, Kimi-owned presentation): `og:image` is
the cafe cover; when the cafe has no cover, the fallback is a flat
`background`-colored card with the cup glyph centered at 32px and the cafe
name in display font — no generated collage, no sparkle frames.

## 5. Missing cafe — 404

A real 404 (spec DG19), composed: centered column, display font line
`This cafe is gone` (`text-xl`), body `It may have been removed`
(`text-sm`, `muted`), solid `accent` button `Back to discover` → `/`. Quiet
and final — no cute illustration, no coffee-pun copy.

## 6. Motion, dark mode, accessibility, i18n

- Static page: the only animation is the banner rise and toast. Reduced
  motion: banner appears instantly.
- Token-only; images undimmed in dark mode.
- Banner is `role="region"` with `aria-label`; its × is keyboard reachable;
  the banner never takes focus on load. The feed-mode toggle links are real
  anchors (`?feed=newest`), fully keyboard/SSR friendly.
- Keys under `cafeDetail.*` and `share.*`. zh references: `Open in
  CoffeeMode` → `打开地图探索`, `Link copied` → `链接已复制`, `This cafe is
  gone` → `这家咖啡馆找不到了`, `It may have been removed` →
  `它可能已经被移除了`, `Back to discover` → `返回发现`.

## 7. Visual acceptance criteria (owner sign-off)

- [ ] view-source shows complete cafe content (SSR proof).
- [ ] The page and the in-app FULL are visibly the same composition.
- [ ] Banner is gentle, dismissible, and never blocks reading.
- [ ] 404 is honest and quiet; the recovery action is unmistakable.
- [ ] The no-cover OG fallback looks designed, not broken.
- [ ] Dark mode requires no per-component overrides.

## Out of scope

Client-side selection/URL machinery (`discovery-sheet`), the check-in drawer
(`checkin-system`), onboarding overlay for plain first visits
(`onboarding` artifact), PWA service-worker behavior (ADR-0003).
