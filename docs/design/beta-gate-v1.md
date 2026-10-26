# Closed Beta Gate — Design Artifact v1

- Slice: closed-beta admission surface (BRAWUKA-970, Owner decision 2026-10-26)
- Status: **Draft — awaiting owner visual acceptance**
  (implementation ships in the BRAWUKA-970 PR on the Owner's explicit
  direction "先出设计 artifact，再实现"; visual acceptance is recorded here
  when the Owner signs off)
- Author: CoffeeMode Implementer (Fullstack) agent
- Date: 2026-10-26
- Base: `docs/design/discovery-sheet-v1.md` (tokens), `docs/design/onboarding-v1.md`
  (single-purpose surface language)
- Specs: `docs/specs/0001-nextjs-migration.md` §Closed beta (behavior);
  `docs/specs/0002-design-system.md` (type scale, palette, states)

Scope: composition, hierarchy, copy, responsive and motion treatment of the
two states of `/beta` — **invitation** (anonymous visitor) and **refusal**
(signed in, not on the allowlist). Admission rules, the allowlist, and the
server-side gate are canonical in spec 0001 and referenced, not redefined here.

---

## 1. Design intent

The beta gate has one job: tell an uninvited visitor, in one breath, that the
product is real, small on purpose, and reachable by invitation — then give
them the single action that matters (sign in) and one quiet way to ask.

It is not a marketing page and not an error page. It is a closed door with a
note on it:

- **No** signup form, no email/password fields, no "create account" link, no
  countdown, no waitlist counter, no social proof, no newsletter capture.
- **No** illustration or mascot. The brand mark and one sentence carry it.
- The page must feel like the rest of the product: warm paper, espresso ink,
  one accent, generous air.

## 2. Layout

One column, vertically centred, `min-h-dvh`, `px-6` on mobile and `px-8` on
≥768px, content capped at `--layout-content-max`. Vertical rhythm 24px
between blocks; the CTA stack is 32px below the copy.

```text
              ☕ CafeMood                     ← wordmark, 18px icon, font-display
       ─────────────────────────────────      ← 1px separator, full column width
              CLOSED BETA                     ← mono kicker, tracking-widest
         CafeMood 内测中                       ← title, font-display text-2xl
   One sentence, serif, ~2 lines, muted.      ← body, font-serif text-md
              [ Continue with Google ]         ← primary, 44px, full column
              Request an invitation ↗          ← quiet text link, 44px target
       Privacy · Terms · About                 ← footer row, xs, muted
```

Mobile (390×844): the block sits optically above centre (the footer row
anchors to the bottom padding), so the title is not stranded mid-screen.
Desktop (1280×800): the same column, never a card, never a two-column
marketing layout. No masthead chrome and no app menu: there is nothing to
navigate to yet.

## 3. States

| State | Kicker | Title | Body | Actions |
|---|---|---|---|---|
| Invitation (anonymous) | `CLOSED BETA` | CafeMood 内测中 | one sentence: small invited circle, sign in with Google to check the list | Google (primary) · request-invite link |
| Refused · just signed in | `NOT ON THE LIST` | This account isn't invited yet | invitation-only; signed out again; ask, or try another Google account | Google (primary) · request-invite link |
| Refused · session still open (revoked mid-beta) | same | same | same + `Signed in as {email}` in mono, 12px | Google · sign-out (outline) · request-invite link |
| Admitted (signed in, allowlisted) | — | — | — | server redirects to `/`; the surface never renders |
| Gate off (`BETA_MODE=0`) | — | — | — | server redirects to `/`; the page is never a dead end |

The refusal state never says "error", never shows a code, and never offers
"try again" as the only path — retrying the same account cannot succeed.

## 4. Typography and color

- Wordmark: `font-display`, `text-md`, `font-extrabold`, `tracking-tight`,
  18px `CoffeeIcon` in `text-accent`.
- Kicker: `font-mono tnum text-xs uppercase tracking-[0.18em] text-muted`.
- Title: `font-display text-2xl font-bold tracking-tight text-foreground`.
  (App-scale ceiling; no display ramp.)
- Body: `font-serif text-md leading-relaxed text-muted`, max 34ch.
- Google CTA: HeroUI `Button variant="primary"` at `min-h-11` (44px),
  full column width, `bg-accent` / `text-accent-foreground`; the existing
  `SignInProviderButtons` renders it, so the provider list stays owned by
  `auth.providers` — a disabled provider is absent, never greyed.
- Request link: `cm-focus`, `min-h-11`, `text-sm`, `text-foreground` with a
  1px underline offset and `hover:text-accent`.
- Footer: `text-xs text-muted`, dot separators, links to the three public
  legal pages.
- Refusal accent: none. The refusal state uses the same palette; only the
  kicker and copy change. A red alert band would read as an outage.

## 5. Motion

No entrance animation, no stagger, no glow. One 150ms `color`/`background`
transition on the CTA and the request link, each with
`motion-reduce:transition-none`. The surface is legible with animation
disabled and before any script runs (server-rendered).

## 6. Accessibility

- Landmarks: one `<main>`, one `<h1>` (the title), footer as `<footer>`.
- Every interactive element ≥44×44px; focus ring via `cm-focus`.
- Contrast: `text-muted` on `background` clears WCAG AA at these sizes
  (same pair already shipped on `/about`, `/privacy`, `/terms`).
- The refusal reason is never conveyed by color alone; the copy says it.
- Document language follows `next-intl` (en/zh), and the title/summary are
  both translated — no English-only fallback on the zh surface.

## 7. Copy (en / zh)

| Key | en | zh |
|---|---|---|
| `kicker` | Closed beta | 内测 · 仅限受邀 |
| `title` | CafeMood is in closed beta | CafeMood 内测中 |
| `body` | A small circle of coffee people first. Sign in with Google to see whether you're on the list. | 先把门开一条缝，邀请一小圈咖啡同路人先进来。用 Google 登录，看看你在不在名单上。 |
| `deniedKicker` | Not on the list | 暂未受邀 |
| `deniedTitle` | This account isn't invited yet | 这个账号还不在名单里 |
| `deniedBody` | The beta is invitation-only. Ask for an invitation, or sign in with another Google account. | 内测只邀请，不开放。可以申请邀请，或换一个 Google 账号登录。 |
| `signedInAs` | Signed in as {email} | 当前登录：{email} |
| `request` | Request an invitation | 申请内测邀请 |
| `signOut` | Sign out | 退出登录 |

## 8. Non-goals

- No signup page, no password field, no Apple button (BRAWUKA-12 stays
  backlog), no invite-code redemption, no waitlist state, no email sending.
- No inline announcement feed: the runtime banner channel stays for
  operational notices only.

## 9. Operations (runbook)

The gate has no admin UI on purpose: the allowlist is operated from a shell,
and the roster's only copy lives in the database (never in the repo — the
issue's "不把邮箱列表硬编码进仓库").

**Invite, inspect, revoke** (`web/`, against the deployment's `DATABASE_URL`):

```bash
node scripts/beta-allowlist.mjs add someone@example.com --note "invited by <who>, <why>"
node scripts/beta-allowlist.mjs list            # or --json for a roster export
node scripts/beta-allowlist.mjs remove someone@example.com
```

`add` normalizes the address to lower case and clears a previous revocation;
`remove` sets `revoked_at` instead of deleting, so the roster keeps its history.
The `note` column is the tester roster's provenance: who invited whom and why.
A decision is cached in-process for `beta.allowlistCacheSeconds` (60 s), so a
revoke lands within that window or on the next deploy — no restart needed to
invite someone.

**Supabase project settings** (owner, once per project — tracked in
`docs/agent/pending-user-actions.md`): public sign-up off, Google provider on,
`Authentication → Hooks → Before User Created` pointed at
`public.beta_before_user_created`. The hook is the second lock: even a direct
`/auth/v1/signup` or an OAuth flow that skips the app cannot create a user for
an address the operator has not invited.

**Feedback channel**: testers reply to the invitation address
(`beta.inviteEmail` in `web/config/app.yaml`, the same mailbox behind the
"Request an invitation" link) and the Owner folds their reports into the
project's issues — there is no in-app feedback form, so the beta surface stays
a single-purpose surface.

**Identity states the operator must be able to explain** (all four are proven
in `http-beta-gate.integration.test.ts` / `beta-gate-e2e.mjs`):

| Who | Page | API |
|---|---|---|
| anonymous | `/beta` (invitation) | 401 `unauthorized` |
| signed in, not on the list | `/beta?denied=1` (refusal, session signed out by the callback) | 403 `beta_not_allowed` |
| signed in, allowlisted | the product | normal envelope |
| revoked mid-session | `/beta?denied=1` within the cache window | 403 `beta_not_allowed` |
