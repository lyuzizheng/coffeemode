# Cafe Detail SSR & Sharing — Design Artifact v1

- Slice: `seo-sharing` (issue #150)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-22 — copy tone sweep per DG87/DG93;
  2026-08-23 — grill round 14 partial rulings DG104–DG109)
- Base: `docs/design/discovery-sheet-v1.md` (FULL composition, icon set,
  score hierarchy are reused verbatim)
- Specs: `docs/specs/0001-nextjs-migration.md` §Rendering strategy
  (`/cafes/[id]` SSR), §Onboarding & city model (deep-link banner), §PWA &
  sharing; `docs/specs/0002-design-system.md` (`DeepLinkBanner` component);
  DG3, DG19 (route ownership, missing-cafe 404)

Scope: composition of the server-rendered `/cafes/[id]` page, the deep-link
banner, the share control, and the 404. Behavior (SSR route ownership,
one-push URL semantics, 404 contract, URL scheme, JSON-LD/sitemap/llms.txt,
CDN cache TTLs) is canonical in the specs (spec 0001 §Rendering strategy,
§Onboarding & city model, §PWA & sharing; DG104–DG107) and is referenced,
not redefined.

---

## 1. Design intent

This page is the product's handshake with the outside world: a link dropped
into a chat must open to something complete, fast, and honest — full content
for a first-time visitor, with a gentle path into the app. Content first,
never a full-screen interruption (spec).

## 2. Page composition — two parts (DG106)

Server-rendered, centered 640px column, 16px/24px side padding, global
header. The page is deliberately two parts:

**Part 1 — the public shell (SSR, crawler-visible, no client JS needed).**
Aggregate product data only: title block, the score pair (Work hero +
Experience), WorkProfile dimension bars with respondent counts, policy
consensus, cover + gallery, hours. This is what Google, AI crawlers, and
link previews see — full semantic HTML, JSON-LD, fast from the CDN cache
(spec-owned, DG105/DG107).

**Part 2 — the check-in feed (client-loaded after paint).** Notes are user
content: they load from the public paginated check-in API once the page is
up, never in the initial HTML — scrapers get the aggregates, not the raw
community content. The Helpful/Newest toggle is a client control hitting
the same API (no `?feed=` SSR variants). While loading, the feed area shows
4 skeleton cards; failure keeps the shell intact with an inline Retry.

Bars render at final width without animation (SSR shell: no entry motion).

**The action block** (DG109 — this page's job is conversion):

- `Check in` — the dominant element: full-width, 56px solid `accent`
  button, `radius-sm`, `text-base`. Routes through the `/?cafe=[id]` app
  entry (DG104): the map app opens with this cafe selected and the
  check-in flow one tap away.
- Below it, a secondary row: `Navigate` (outline sage, provider deep link
  per spec) and `Share` (ghost icon, §4) — same styling as
  discovery-sheet-v1 §4, visually subordinate to the CTA.

## 3. Deep-link banner (DeepLinkBanner)

First-visit only (spec-owned storage rules): a lightweight bottom banner,
never modal.

- Mobile: bottom-anchored bar, full width minus 16px margins, `overlay`
  surface, `radius-lg`, `shadow-map`, 1px `border`. One tappable row: 20px
  cup glyph (icon set), `CoffeeMode` (`text-sm`, medium weight), then
  `Open in CoffeeMode` (`text-sm`, `accent` text) as the action, and a 28px
  ghost × at the right edge. The action routes through the `/?cafe=[id]`
  app entry (DG104) — the map opens with this cafe already selected.
- Desktop: same banner, 420px, bottom-center.
- Enter: 200ms gentle rise (spec signature moment), never blocking content;
  dismissal persists permanently via a `localStorage` flag in the spec's
  onboarding storage family — a dismissed banner that returns every session
  is nagging. (Owner decision, 2026-08-21 — DG29.)
- The banner yields layout: it overlays, it does not push content.

## 4. Share control

The `Share` ghost icon button (36px, share-node glyph) triggers the spec's
flow: Web Share API where available, copy-link otherwise — with one
day-one addition (DG109): **WeChat is a first-class target from MVP.** Its
in-app browser has no Web Share API and unreliable previews, so:

- **Copy link is always a visible action**, not just a fallback: tapping
  Share opens the native share sheet where available; inside WeChat (UA
  detection) it instead shows a small `overlay` popover with a solid
  `Copy link` button and the hint `复制链接，发给朋友吧` — WeChat sharing
  is copy-paste by nature, and we design for it instead of pretending
  otherwise.
- Copy feedback is a HeroUI toast: `Link copied` with the ✓ glyph, 150ms in.
- No share sheet of our own beyond the WeChat popover, no QR codes, no
  social buttons row at MVP.

OG/social card (spec-owned content, Kimi-owned presentation): `og:image` is
the cafe cover; when the cafe has no cover, the fallback is a flat
`background`-colored card with the cup glyph centered at 32px and the cafe
name in display font — no generated collage, no sparkle frames.

Preview copy (DG108): `og:title` = `{cafe name} · {city} — CoffeeMode`;
`og:description` shows the **overall (Experience) score only** plus a
curiosity hook — the full fact line stays on the page itself (Part 1 shell):
- zh: `✨ 87 · 23 位 nomad 打卡 — 这里真的适合办公吗？`
- en: `✨ 87 from 23 nomads — is it actually work-friendly?`
(Score omitted honestly when there is no data: `还没有打卡 — 来当第一个？`)

## 5. Missing cafe — 404

A real 404 (spec DG19), composed: centered column, display font line
`This cafe is gone` (`text-xl`), body `It may have been removed`
(`text-sm`, `muted`), solid `accent` button `Back to discover` → `/`. Quiet
and final — no cute illustration, no coffee-pun copy.

## 6. Motion, dark mode, accessibility, i18n

- Static shell: the only animations are the banner rise and toast. Reduced
  motion: banner appears instantly. The feed loads client-side with its own
  skeleton (§2).
- Token-only; images undimmed in dark mode.
- Banner is `role="region"` with `aria-label`; its × is keyboard reachable;
  the banner never takes focus on load. The feed-mode toggle is a client
  control (Part 2), fully keyboard reachable once loaded.
- Keys under `cafeDetail.*` and `share.*`. zh references: `Open in
  CoffeeMode` → `打开地图探索`, `Link copied` → `链接已复制`, `Copy link` →
  `复制链接`, `复制链接，发给朋友吧`, `This cafe is
  gone` → `这家咖啡馆找不到了`, `It may have been removed` →
  `它可能已经被移除了`, `Back to discover` → `返回发现`.

## 7. Visual acceptance criteria (owner sign-off)

- [ ] view-source shows the complete public shell (title, scores, bars,
      policies, gallery) — and NOT the check-in feed (DG106).
- [ ] The page and the in-app FULL read as the same composition, with the
      big `Check in` CTA unmistakable as the page's primary job (DG109).
- [ ] Inside a WeChat UA, Share shows the copy-link popover — no dead
      native-share call (DG109).
- [ ] Banner is gentle, dismissible, and never blocks reading.
- [ ] 404 is honest and quiet; the recovery action is unmistakable.
- [ ] The no-cover OG fallback looks designed, not broken; og:description
      carries only the ✨ score + hook (DG108).
- [ ] Dark mode requires no per-component overrides.

## Out of scope

Client-side selection/URL machinery (`discovery-sheet`), the check-in drawer
(`checkin-system`), onboarding overlay for plain first visits
(`onboarding` artifact), PWA service-worker behavior (ADR-0003).
