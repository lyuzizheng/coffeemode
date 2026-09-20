# 0011. API Error Handling & Observability

Status: Proposed (BRAWUKA-535). Owner-approved direction: HTTP status carries
success/failure semantics — 2xx success, 4xx caller error, 5xx server error —
with a stable machine-readable `code` on top. No `200 + error-in-body`, no
custom HTTP status ranges.

## Goal

One error contract across the Next.js app and both Cloudflare Workers
(`poi-service`, `image-service`), one client-side consumption pattern, and
enough structured logging to trace any production failure to a single request
without a SaaS APM. This spec consolidates what already exists (`apiError()`,
`guard()`, `logError()`, `x-request-id`, Better Stack rate-limit alerts) into a
contract, fixes the gaps the BRAWUKA-535 audit found, and freezes the error-code
vocabulary in a registry.

## Audit summary (basis for the decisions below)

Full audit: three parallel passes over `web/app/api/**` (27 route files),
`web/lib/**`, `web/proxy.ts`, `poi-service/src/**`, `image-service/src/**`, and
every browser `fetch` call site. Findings that drive this spec:

**P0**

- `poi-service` logs raw upstream exceptions; Google geocode URLs embed
  `GOOGLE_PLACES_API_KEY`, so the key can land in Workers logs (`upstream/google.ts`,
  `handlers.ts` catch paths). Secret-in-logs leak.

**P1**

- `guard()` is invoked *outside* the handler `try/catch` in every web route
  (e.g. `app/api/cafes/route.ts:55` vs `try` at `:62`). A throw inside
  `getCurrentUser()`/`checkRateLimit()` escapes the `{error}` envelope AND
  `logError` — clients get a non-JSON Next.js 500 and observability loses the
  event. ~20 routes share the shape.
- `responseMessage()` renders server-authored English `message` verbatim to zh
  users on any non-429 error (`lib/http.ts:57`) — systematic i18n leak.
- Default TanStack retry (`lib/query/retry.ts`) retries 401/403/404/429 twice;
  `Retry-After` is emitted (`lib/rate-limit.ts:208`) but never read by any
  client — amplified load during rate-limit episodes.
- Workers have no request-id, no structured logger, and 4 envelope variants;
  `image-service` lacks the `[observability]` block `poi-service` has.
- 401 handling gaps: `profile-hero`, `profile-tab-*`, `settings-view` DELETE,
  `cafe-owner-controls` treat 401 as generic failure instead of SignInGate.
- Account deletion (`settings-view.tsx`) does not clear the TanStack client or
  the IndexedDB-persisted cache — deleted-account data persists in the browser.

**P2** (selected; full list in the issue audit threads)

- `use-network-status.ts` flips the app to "offline" on any non-ok
  `/api/health`, conflating server-down with offline.
- `logErrorCode` writes `response.url` incl. query string (`/api/search?q=…`)
  to console — user input in logs.
- `apiError(code, msg)` without `options.status` silently yields 400 —
  positional footgun (45 `invalid_request` call sites).
- `GET /poi/reverse` mutates state (D1 upsert + KV delete) — side-effecting GET.
- `use-checkin-feed` like failures toast `load_failed` (wrong copy for a write).
- No client-side error reporting at all — `console.*` is the only sink.

## Stable decisions

### D1 — HTTP status is the success/failure signal

- 2xx = success. A 2xx body MUST NOT carry an `error` field or an `ok: false`
  flag. Per-item outcomes inside a 2xx batch (e.g. `places/external`
  `skipped[]`) are data, not errors, and stay.
- 4xx = the caller can fix the request. Subdivide, never collapse to 400:
  - `400` malformed input: unparseable JSON, wrong types, out-of-range values.
  - `401` missing/invalid/expired authentication.
  - `403` authenticated but not allowed: ownership, origin/CSRF, bot
    verification, self-action rules.
  - `404` resource does not exist (or is invisible — do not distinguish).
  - `409` state conflict: duplicate, precondition failed, resource blocked by
    dependents.
  - `410` resource permanently gone (expired feed cursor snapshot).
  - `413` payload too large (photo bytes, body cap).
  - `422` semantic validation: well-formed input that violates domain rules.
  - `429` rate limited; always with `Retry-After`.
- 5xx = server fault. `500` is the catch-all; `502` upstream dependency failed;
  `503` configured dependency unavailable (`db_unavailable`,
  `mapkit_not_configured`); `504` only for upstream timeouts if ever needed.
- Reclassifications from current behavior (migration list, §Registry):
  `cafe_has_other_checkins` 403→409; `invalid_photos`,
  `handle_change_too_soon`, `invalid_current_city`, `invalid_last_location`,
  `invalid_onboarded`, `invalid_display_name`, `display_name_length` 400→422.

### D2 — Error envelope: flat, additive

All non-2xx API responses are JSON:

```json
{ "error": "checkin_already_exists", "message": "...", "details": { ... }, "request_id": "..." }
```

- `error` (string, required): the machine code. `lower_snake_case`, registered
  in §Registry. This is the contract clients branch on.
- `message` (string, optional): developer-facing English diagnostic. **Never
  rendered in the UI** — clients map `error` to i18n keys (D9). Server authors
  may write precise English; it is log/support text.
- `details` (object, optional): machine-readable extras — `existing_checkin_id`,
  `cafe_id`, `n`, `fields[]` for 422. New extras go under `details`, never
  top-level. The three existing top-level extras (`cafe_id`,
  `existing_checkin_id`, `n`) are legacy: keep emitting them for one release,
  then drop after clients migrate.
- `request_id` (string, required on 5xx, recommended on all errors): the
  `x-request-id` value, so a user report can be grepped. Cheap, additive.
- Rejected alternative: nested `{error:{code,message}}` (the issue's suggested
  shape). It buys nothing semantically and breaks every deployed consumer —
  `responseMessage`, `body.error` branches, worker callers — for a rename.
  Flat stays; `details` absorbs the growth.

### D3 — Error-code registry is the single source of truth

- `web/shared/errors.ts` (new): `export const ERROR_CODES = { code: { status,
  domain, summary } }` — the compile-time registry. `apiError()` and the worker
  `json({error})` helpers take `keyof typeof ERROR_CODES`; unregistered codes
  fail typecheck. `web/shared/` is already the cross-service import root
  (`shared/auth.ts`, `shared/uuid.ts`), so workers share the registry.
- Naming: `lower_snake_case`, domain-prefixed where the domain exists
  (`cafe_*`, `checkin_*`, `handle_*`). Existing codes are grandfathered
  verbatim — renaming a code is a contract break, not a cleanup.
- Adding a code = one registry entry + one spec-table row. Deleting a deployed
  code requires a client-release grace period.

### D4 — Domain errors and validation results

- New `ApiHttpError extends Error { code, status, details? }` in
  `web/lib/api/` — thrown by db/domain layers (`lib/db/*` already throws typed
  errors like `DuplicateCheckInError`; they gain `code`/`status` mapping at the
  route boundary, not by extending ApiHttpError themselves — domain stays
  HTTP-free).
- Validators keep the `ParseResult<T>` shape (`{ok:true,value} |
  {ok:false,message}`) and gain optional `code` + `fields`. Structural
  failures → 400 `invalid_request`; domain-rule failures → 422 with a specific
  code and `details.fields: [{field, reason}]`.
- No zod/valibot: hand-rolled validators already cover every payload and the
  registry gives the missing piece (typed codes), not a schema library.

### D5 — One route wrapper owns the boundary

New `apiRoute()` in `web/lib/api/`:

```ts
export const POST = apiRoute(
  { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/checkins" },
  async (req, ctx) => { /* ctx.user, ctx.requestId */ },
);
```

- Owns, in order: request-id resolution → origin check (mutations) → `guard()`
  (auth + rate limit) → handler → catch-all mapping: `ApiHttpError` → its
  envelope; known domain errors → registered mapping; unknown → `logError` +
  `500 internal_error` + `request_id`.
- Fixes P1-1 structurally: nothing user-thrown can escape the envelope or the
  error log again. Per-route try/catch becomes unnecessary and is removed.
- `requireAuth` ordering stays auth-before-validation: anonymous callers get
  401, never a 400/404 that leaks resource existence.
- Exempt from the wrapper: `/api/health` (must not touch slow deps),
  `auth/callback` (redirect contract), `og-image` (image bytes), `serwist`
  (library-generated). Exemptions are listed here, not invented per-route.

### D6 — Workers adopt the same contract

- `poi-service` and `image-service` keep the shared `web/shared/auth.ts`
  envelope (`{error, message?}`) and add: `request_id` (accept inbound
  `x-request-id`, else `crypto.randomUUID()`, echo on response), a minimal
  `logError` JSON-line twin of the web logger, and registry-typed codes.
- Auth gate order unified: global Bearer gate immediately after `/health`
  (poi-service order) — image-service moves its per-handler checks up.
- **Secret scrubbing (P0)**: upstream clients never log raw request URLs or
  rethrow upstream bodies; `upstream/google.ts` strips `key=` from anything
  that can reach a log line. Worker error bodies never echo upstream `status`/
  `message` fields — normalize to `upstream_error`/`invalid_upstream`.
- `image-service` `wrangler.toml` gets the `[observability]` block
  `poi-service` already has.

### D7 — Logging & correlation

- Web unchanged in shape: `{type:"access"|"error", request_id, ...}` JSON lines
  (ADR-0004). Two additions: access lines gain `code` when status ≥ 400
  (enables per-code metrics without parsing error lines); `logError` gains a
  `warn` sibling (`logWarn`) for security-relevant 4xx — `forbidden_origin`,
  `bot_verification_failed`, repeated `unauthorized` — so they are greppable
  without paging on them.
- `request_id` propagates web → worker: `poi-client` and
  `image-service-client` forward the inbound `x-request-id` on upstream calls.
- Log content rules unchanged and now contractual: no tokens, emails, PII,
  request bodies, or full URLs with query strings. `clientId` is
  `user:<uuid>` or `anon:<sha256(ip)>` — never raw IP.

### D8 — Metrics & alerts stay on Better Stack

ADR-0005 already adopted Better Stack for a bounded scope; this spec extends,
does not replace:

- New `coffeemode-api-errors` source (staging + prod pair): the stdout
  error/access JSON lines, same ingest pattern as `rate-limit-alert.ts`.
- Dashboard: 5xx count by `route`, error `code` histogram, 429 by `bucket`.
- Alerts: 5xx rate > threshold per route; `rate_limited` spike (exists);
  worker `upstream_error` spike.
- No client-side error reporting SDK and no client-error ingest endpoint in
  this iteration — console-only stays. Revisit when volume justifies it; the
  `request_id`-in-body decision (D2) is what makes "user reports an error"
  actionable without it.
- Remains owner-side: Better Stack token provisioning per environment
  (`docs/agent/pending-user-actions.md` §7).

### D9 — Frontend: one `apiFetch`, code-driven i18n, discriminating retry

- New `apiFetch` in `web/lib/http.ts` — the only browser entry point for
  `/api/*`. Returns parsed JSON on 2xx; throws `ApiError { status, code,
  details?, requestId? }` otherwise. `ApiError` on 401 carries the existing
  `UNAUTHORIZED` marker contract so SignInGate keeps working.
- `responseMessage`/`userFacingMessage` are retired into `apiFetch`'s mapper:
  `error` code → i18n key via a `code → key` table per domain (e.g.
  `handle_taken` → `profile.identity_error_handle_taken`); unknown/absent code
  → caller's localized fallback; `message` is logged, never rendered. This
  closes the P1 i18n leak.
- Retry: queries retry only on network error or 5xx (max 2, keep the
  `navigator.onLine` gate); 4xx never retries; 429 honors `Retry-After` once
  instead of immediate retries; mutations stay `retry: 0`.
- All ~30 raw `fetch('/api/...')` call sites migrate to `apiFetch`; the 401
  gaps (profile, settings, owner controls) adopt the SignInGate convention;
  account deletion clears query cache + IndexedDB persistors like
  `SignOutButton` does.
- `use-network-status` treats only network failure/timeout as offline; a 5xx
  health response is "server down", not "you are offline".

## Data/API/UI behavior

### Registry (initial version — covers every code emitted today)

| Code | Status | Domain | Notes |
| --- | --- | --- | --- |
| `unauthorized` | 401 | auth | missing/invalid session or service token |
| `forbidden` | 403 | auth | authenticated, not owner/allowed |
| `forbidden_origin` | 403 | auth | cross-origin mutation rejected |
| `bot_verification_failed` | 403 | auth | Turnstile failure (collapses 4 turnstile codes) |
| `invalid_provider` | 400 | auth | OAuth provider unknown |
| `provider_start_failed` | 500 | auth | OAuth start failed |
| `signout_failed` | 500 | auth | |
| `not_configured` | 503 | auth | auth backend not configured |
| `invalid_request` | 400 | request | malformed input (catch-all structural) |
| `invalid_body` | 400 | request | body not a JSON object |
| `invalid_limit` | 400 | request | pagination limit out of range |
| `invalid_cursor` | 400 | request | malformed feed cursor |
| `cursor_version_expired` | 410 | request | feed snapshot expired → restart page one |
| `rate_limited` | 429 | request | + `Retry-After` header |
| `internal_error` | 500 | server | catch-all; body carries `request_id` |
| `upstream_error` | 502 | server | upstream dependency failed |
| `db_unavailable` | 503 | server | Postgres pool down |
| `not_found` | 404 | resource | generic missing resource |
| `profile_not_found` | 404 | profile | |
| `invalid_handle` | 400 | profile | handle syntax |
| `handle_taken` | 409 | profile | |
| `handle_change_too_soon` | **422** | profile | was 400 — semantic cooldown rule |
| `invalid_display_name` | **422** | profile | was 400 |
| `display_name_length` | **422** | profile | was 400 |
| `invalid_current_city` | **422** | profile | was 400 |
| `invalid_last_location` | **422** | profile | was 400 |
| `invalid_onboarded` | **422** | profile | was 400 |
| `empty_patch` | 400 | request | PATCH with no fields |
| `cafe_exists` | 409 | cafe | + `details.cafe_id` |
| `cafe_has_other_checkins` | **409** | cafe | was 403 — state conflict, not authz; + `details.n` |
| `duplicate_checkin` | 409 | checkin | + `details.existing_checkin_id` |
| `self_like_forbidden` | 403 | checkin | |
| `invalid_photos` | **422** | checkin | was 400 — photo ids well-formed but unconsumed |
| `invalid_maps_url` | 400 | places | URL host not allowlisted |
| `poi_service` | passthrough | places | upstream worker status mirrored (502/404/413/422 only — client sanitizes) |
| `image_service_error` | passthrough | images | same sanitization contract |
| `mapkit_not_configured` | 503 | mapkit | |
| `mapkit_token_error` | 500 | mapkit | |
| `unresolvable` | 422 | poi-worker | no upstream provider for source |
| `invalid_upstream` | 502 | poi-worker | upstream returned unparseable data |

Codes marked **bold** change status in migration; everything else is frozen
as-is. New codes anticipated by the audit: none required — the vocabulary is
complete; growth happens only with new routes.

### Client-visible changes

- zh users stop seeing English server prose on validation errors — every
  rendered string comes from `messages/*.json`.
- 429 surfaces show the localized fallback after `Retry-After`, not an instant
  double-retry.
- 5xx error surfaces may quote `request_id` for support.

## Edge cases

- **Uncaught throw in `guard()`/auth backend** → wrapper catch-all: `logError`
  + `500 internal_error` + `request_id`. Never Next's HTML 500 on `/api/*`.
- **Worker called without `x-request-id`** → generates one; correlation breaks
  only for direct worker hits (internal-only callers, acceptable).
- **Upstream 4xx from workers** (`poi_service`, `image_service_error`
  passthrough): the web client sanitizes to 502/404/413/422 before the route
  sees it — a worker 4xx never leaks as our 4xx to the browser.
- **`GET /poi/reverse` mutates** (D1 upsert + KV delete): documented as a
  known deviation; a future spec decides whether it becomes POST. Not changed
  here — out of scope.
- **429 during a mutation**: mutations never retry; the user retries manually —
  `Retry-After` informs the disabled-state duration, not auto-replay.
- **Legacy top-level extras** (`cafe_id`, `existing_checkin_id`, `n`): emitted
  alongside `details` for one release; clients read `details` first.
- **Health/heartbeat/config/serwist skip the proxy** → no access-log coverage,
  by design (hot paths, no auth surface). Documented, accepted.
- **Non-JSON 5xx from infrastructure** (Dokploy/edge before Next): clients must
  tolerate a non-envelope error — `apiFetch` maps unparseable bodies to
  `ApiError{code:"internal_error"}`.

## Tests / acceptance criteria

- `web/shared/errors.ts` exists; `apiError`/`json({error})` reject unregistered
  codes at typecheck; registry table above matches the file.
- `apiRoute` wrapper: a handler throwing an unknown error returns
  `{error:"internal_error", request_id}` 500 + one `logError` line; a thrown
  `ApiHttpError` returns its code/status; `guard()` failures are enveloped.
- Every `web/app/api/**` route uses `apiRoute` (or is on the exemption list);
  grep finds zero bare `export async function POST` outside exemptions.
- Reclassified codes return their new statuses; clients branching on
  `cafe_has_other_checkins`/`duplicate_checkin` still work (they match `code`,
  not status).
- Workers: `x-request-id` echoed, JSON error lines, no `key=` substring in any
  logged string (unit test with a fake upstream throw), `image-service`
  wrangler `[observability]` enabled.
- `apiFetch`: 401 → `UNAUTHORIZED` marker; 429 → waits `Retry-After` once;
  zh-locale render of a validation failure contains no English server prose.
- Query retry: 404/401/403 are not retried (unit test on `shouldRetryQuery`
  with an `ApiError`-typed failure input).
- Account deletion clears TanStack cache + IndexedDB persistors.
- Better Stack `coffeemode-api-errors` source receives staging traffic; 5xx
  alert fires on a synthetic `internal_error` (same verification pattern as
  the rate-limit alert).
- No new runtime dependencies.

## Implementation slices

Sub-issues under BRAWUKA-535, staged (stage N+1 parks until N closes):

- **Stage 1** — shared contract: `web/shared/errors.ts` registry, envelope
  helpers updated (`apiError` `details`/`request_id`, worker `json`),
  `ApiHttpError`, `logWarn`. Everything else imports this.
- **Stage 2** — (a) `apiRoute` wrapper + web route migration + status
  reclassifications; (b) frontend `apiFetch` + i18n code map + retry policy;
  (c) worker alignment (request-id, logging, secret scrub, auth order,
  wrangler observability). (a)(b)(c) are independent given Stage 1.
- **Stage 3** — call-site migration to `apiFetch` (~30 sites) + 401/UX gap
  fixes; Better Stack sources/dashboard/alerts (DevOps, owner-token dependent).
