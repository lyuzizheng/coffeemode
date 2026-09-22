# 0008. Check-in Feed — Unvirtualized Rendering Accepted Until Deep-Scroll Threshold

## Status

Accepted

## Context

BRAWUKA-656 (split out of the AUDIT-S3 optimization list, parent BRAWUKA-416)
flagged `CheckinFeed` (`web/components/discovery/checkin-feed.tsx`) for
rendering every loaded page: the card list maps all accumulated `checkins`
into mounted `FeedCard`s, and cursor pagination only ever appends. DOM size
grows linearly with scroll depth — there is no windowing.

The feed's real shape bounds the cost:

- **Pages are small.** `feed.pageSize` is 20 (`web/config/app.yaml`), so five
  full pages — a long scroll session — is 100 cards.
- **Cards are light.** A `FeedCard` is a meta line, text mini-score chips, a
  serif note, an optional photo strip of 72px thumbnails (`THUMB_PX` in
  `web/lib/layout.ts`), and one like button. No charts, no media players, no
  per-card subscriptions.
- **Image cost is already bounded.** `next/image` lazy-loads thumbnails, so
  off-screen cards cost DOM nodes, not network or decode work.

## Decision

Accept the unvirtualized list as-is. No `Virtualizer`, no windowing, no
page-cap eviction at current scale. Revisit when any trigger in
*Revisit triggers* fires.

Why virtualization is rejected now:

- **Variable heights + document scroll.** Cards vary in height (optional
  photo strip, variable note length) and the feed scrolls with the page, not
  inside its own scrollport. Correct virtualization here needs dynamic
  measurement plus window-scroll integration — the highest-complexity
  virtualizer configuration, and the one most prone to scroll-jump and
  measurement-thrash bugs.
- **The sentinel interacts badly with windowing.** The
  `IntersectionObserver` sentinel that triggers `fetchNextPage` lives after
  the last card; under windowing it must move into the virtualized range or
  be replaced by scroll-position callbacks, and a mis-measured tail can
  stall or double-fire pagination.
- **Cards carry stateful children.** `OwnCardEditEntry` mounts
  `CheckinDrawer` per owned card, and like buttons hold pending state.
  Unmounting off-screen cards mid-interaction (drawer open, like in flight)
  is a correctness hazard a virtualizer does not solve for free.
- **The measured cost is acceptable.** At ~100–200 mounted cards of this
  weight, layout and reconciliation stay within budget on target devices;
  the audit itself rated the item acceptable within hundreds of entries.

## Revisit triggers

Reopen this decision when any of the following holds:

- Real sessions regularly accumulate **~500+ mounted cards** (≈25 pages), or
  feed interaction jank shows up in RUM / Lighthouse on mid-tier mobile.
- `feed.pageSize` grows substantially, or cards gain heavy content (video,
  maps, inline comments) that raises per-card cost.
- The feed moves into its own scroll container, which removes the
  window-scroll complexity and makes virtualization cheap.

When revisiting: use `react-aria-components` `Virtualizer` (already a
dependency) with dynamic measurement and window scrolling; hoist the
pagination sentinel out of the virtualized range or drive `fetchNextPage`
from the virtualizer's scroll-end signal; keep `CheckinDrawer` mounted
outside the virtualized list so an open drawer survives its card
unmounting.

## Consequences

- BRAWUKA-656 closes as a documented accepted risk, not an unexamined one.
- Residual risk: a very deep scroll session grows the DOM linearly. The
  failure mode is gradual scroll/render jank on low-end devices, not
  incorrectness — no data or interaction contract changes.
- No code changes; `checkin-feed.tsx` keeps its current append-only list
  and sentinel-driven pagination.

## Related

- `web/components/discovery/checkin-feed.tsx` — the unvirtualized list and
  sentinel
- `web/components/discovery/feed-card.tsx` — card composition and cost
- `web/config/app.yaml` — `feed.pageSize: 20`
- `web/lib/layout.ts` — `THUMB_PX = 72`
- ADR-0007 (sitemap full scan accepted) — same "written acceptance via ADR"
  pattern for AUDIT-S3 findings
- BRAWUKA-656 (this item), BRAWUKA-416 (AUDIT-S3 parent)
