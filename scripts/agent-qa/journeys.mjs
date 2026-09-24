/**
 * Agent-QA journey registry (BRAWUKA-411).
 *
 * The autopilot's journey list, decoupled from its prose prompt template so
 * the matrix can expand journey-by-journey without rewriting the prompt.
 * Each journey declares, up front: the persona it needs, the write quota it
 * consumes, the steps a runner performs, and the deterministic verdict
 * assertions plus the semantic questions the LLM answers. Precondition
 * failures (missing secrets, unset env) report as `blocked`, never as a
 * product defect — the autopilot files nothing from a blocked journey.
 *
 * @typedef {"anonymous" | "regular" | "fresh" | "regular+fresh"} JourneyPersona
 * @typedef {"read" | "checkin" | "profile" | "cafe+checkin" | "image" | "like" | "cafe"} JourneyWriteKind
 *
 * @typedef {object} JourneyVerdict
 * @property {string[]} deterministic assertions checkable without judgment
 *   (HTTP statuses, element presence, response shapes, ledger entries)
 * @property {string[]} semantic questions the runner answers
 *   pass/fail/inconclusive from rendered evidence
 *
 * @typedef {object} JourneyPrecondition
 * @property {string} name short key for the report (e.g. `supabase-keys`)
 * @property {string} check what must hold before the journey may run
 *
 * @typedef {object} JourneyDefinition
 * @property {string} id stable id — the dedup key stem (`旅程名+症状` joins this)
 * @property {"P0" | "P1" | "P2" | "P3"} priority rollout priority (issue table order)
 * @property {JourneyPersona} persona which `agent-qa-*` identity runs it
 * @property {JourneyWriteKind} writes quota family consumed (quota keys: cafe/checkin/image)
 * @property {string} summary one-line intent for the run log
 * @property {string[]} steps ordered runner steps against staging
 * @property {JourneyVerdict} verdict assertions declared up front
 * @property {JourneyPrecondition[]} preconditions env/secrets that must hold
 * @property {string} [gateNote] why the journey stays parked when preconditions fail
 */

/** Precondition: staging Supabase triple present in the runner env. */
const SUPABASE_KEYS = Object.freeze({
  name: "supabase-keys",
  check: "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY resolve via resolveAgentQaSupabaseEnv (staging project ojujmjewtbquiddswyrg)",
});

/** Precondition: Cloudflare Access service token present in the runner env. */
const ACCESS_TOKEN = Object.freeze({
  name: "access-token",
  check: "CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET present; /api/health probes 200 with a real browser UA",
});

const GOOGLE_PLACES_KEY = Object.freeze({
  name: "google-places-key",
  check: "GOOGLE_PLACES_API_KEY installed on the staging POI worker (owner pending-user-actions §5)",
});

const IMAGE_SERVICE_STAGING = Object.freeze({
  name: "image-service-staging",
  check: "image-service-staging worker reachable; POST /api/images/upload issues an upload intent for the runner",
});

const SECOND_PERSONA = Object.freeze({
  name: "second-persona",
  check: "a second provisioned persona (agent-qa-fresh-N alongside agent-qa-regular) with its own session",
});

const TURNSTILE_OBSERVATION = Object.freeze({
  name: "turnstile-present",
  check: "staging serves NEXT_PUBLIC_TURNSTILE_SITE_KEY so the places-resolve widget can mint a token",
});

/**
 * Ordered journey matrix: P0 first, then P1 → P2 → P3. `Never` rows
 * (interactive OAuth click-through) are intentionally absent — spec 0010 §3
 * keeps those manual smoke.
 *
 * @type {readonly JourneyDefinition[]}
 */
export const AGENT_QA_JOURNEYS = Object.freeze([
  Object.freeze({
    id: "p0-anonymous-discovery",
    priority: "P0",
    persona: "anonymous",
    writes: "read",
    summary: "Anonymous discovery: / → first cafe → /cafes/[id] → theme/locale toggles → back",
    steps: [
      "GET / (200) with Access cookie bootstrap; discovery sheet/map lists cafes",
      "Open the first cafe → GET /api/cafes/[id] (200) renders SSR detail",
      "Toggle theme light→dark and locale en→zh; both apply visibly",
      "Return to /; no writes performed (verify ledger empty)",
    ],
    verdict: {
      deterministic: [
        "each navigation returns HTTP 200",
        "cafe list is non-empty; detail shows the same cafe id",
        "console errors contain only F10-whitelisted Access-redirect noise",
        "per-page load time recorded; ledger has zero entries",
      ],
      semantic: [
        "does the cafe detail render correctly (name, scores, map)?",
        "does the zh locale actually switch copy (not just the toggle state)?",
        "does dark theme apply (background/text invert, no unreadable regions)?",
      ],
    },
    preconditions: [ACCESS_TOKEN],
  }),
  Object.freeze({
    id: "p1-login-checkin",
    priority: "P1",
    persona: "regular",
    writes: "checkin",
    summary: "Login + check-in: magic-link login → find seed cafe → submit check-in → appears in feed",
    steps: [
      "Bootstrap agent-qa-regular session: Admin API generateLink → navigate /auth/callback (200, session cookie set)",
      "GET /api/search?q=a&limit=5 → pick the staging seed cafe id",
      "POST /api/checkins {cafe_id, scores:{overall,wifi}, note} with fresh idempotency_key → 201 {checkin_id}; record ledger + quota",
      "GET /api/cafes/[id]/checkins?mode=newest → new checkin_id present",
      "GET /api/profile/checkins → new checkin_id present",
      "Cleanup: DELETE /api/checkins/[id]; confirm 404 on re-read of own feed entry",
    ],
    verdict: {
      deterministic: [
        "/auth/callback returns 200 and subsequent authed calls stop 401ing",
        "POST returns 201 (or 200 deduped on retry) with a UUID checkin_id",
        "cafe feed (newest) contains checkin_id within one fetch",
        "profile checkins list contains checkin_id",
        "cleanup DELETE returns 200; ledger entry marked removed",
      ],
      semantic: [
        "does the submitted note text render on the cafe feed card?",
        "does the new score move the cafe's displayed aggregate (direction only)?",
        "any visible error/toast during submit that the API calls hide?",
      ],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS],
  }),
  Object.freeze({
    id: "p1-profile",
    priority: "P1",
    persona: "regular",
    writes: "profile",
    summary: "Profile: change displayName/currentCity → persists after reload → toggle public identity",
    steps: [
      "Bootstrap agent-qa-regular session via magic link (as p1-login-checkin)",
      "GET /api/profile → record baseline displayName/currentCity",
      "PATCH /api/profile {displayName, currentCity} → 200 echoes new values",
      "GET /api/profile → new values persist (reload check)",
      "PATCH /api/profile/identity {showPublicIdentity:true} → 200 {ok:true}; toggle back to false → 200",
      "Restore baseline displayName/currentCity via PATCH (leave no drift)",
    ],
    verdict: {
      deterministic: [
        "PATCH echoes the exact displayName/currentCity sent",
        "re-GET after patch returns the new values (persistence, not echo)",
        "identity PATCH true→200 then false→200, both {ok:true}",
        "baseline restored: final GET matches pre-run values",
      ],
      semantic: [
        "does the profile page render the new displayName without reload tricks?",
        "does the public-identity toggle visibly change the profile surface?",
      ],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS],
  }),
  Object.freeze({
    id: "p2-search",
    priority: "P2",
    persona: "anonymous",
    writes: "read",
    summary: "Search: keyword + nomad filters (wifi/coffee) narrow results",
    steps: [
      "GET /api/search?q=a&limit=5 → record baseline total_count (seed cafe present)",
      "GET /api/search?q=a&limit=5&filter_wifi=80 → total_count drops vs baseline (verified live 1→0)",
      "GET /api/search?q=a&limit=5&filter_wifi=0 → total_count 0 (seed has no wifi rated rows; =0 keeps rated-only, excludes unrated — not 'unlimited') → GET /api/search?q=a&limit=5 with no filter param → total_count recovers to baseline (omit-param is the 'Any' contract)",
      "Repeat with filter_coffee=80 vs 0 for the second nomad dimension (seed check-in scores only overall=51; wifi/coffee/outlets have no rated rows — verified live)",
    ],
    verdict: {
      deterministic: [
        "baseline total_count >= 1 (seed cafe present; else blocked: staging-seed)",
        "filter_wifi=80 returns fewer results than baseline (narrowing, not error)",
        "filter_wifi=0 returns 0 on seed (no wifi rated rows; =0 keeps rated-only, excludes unrated — not 'unlimited')",
        "omitting filter_wifi recovers to baseline count (omit-param is the 'Any'/unlimited contract; filter is selective, not destructive)",
        "same narrowing/exclusion pair holds for filter_coffee (seed has no coffee rated rows either; outlets skipped: no rated rows)",
      ],
      semantic: [
        "does the /search UI expose these filters where a nomad worker would find them?",
        "do empty filtered results render a helpful empty state (not a blank page)?",
      ],
    },
    preconditions: [ACCESS_TOKEN],
  }),
  Object.freeze({
    id: "p2-create-cafe",
    priority: "P2",
    persona: "regular",
    writes: "cafe+checkin",
    summary: "Create cafe: synthetic POI → fused first check-in → detail visible → delete (cleanup)",
    steps: [
      "Bootstrap agent-qa-regular session via magic link",
      "POST /api/cafes {name, lat, lng, city, checkin:{scores:{overall}}} → 201 {cafe_id, checkin_id}; record ledger + quotas (cafe 1, checkin 1)",
      "GET /api/cafes/[cafe_id] → 200 renders the new name",
      "DELETE /api/cafes/[cafe_id] {confirm:true} → 200; GET detail → 404 (closes the loop, doubles as cleanup)",
    ],
    verdict: {
      deterministic: [
        "POST returns 201 with UUID cafe_id + checkin_id",
        "detail GET shows the submitted name before delete",
        "DELETE returns 200 {ok:true}; detail GET returns 404 after",
        "quotas consumed: cafe ≤3, checkin ≤5 for the round",
      ],
      semantic: [
        "does the new cafe appear in search before deletion?",
        "does the fused first check-in render on the new detail page?",
      ],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS],
    gateNote:
      "The Google-POI-pick step from the issue table stays parked until GOOGLE_PLACES_KEY lands; the journey runs end-to-end with synthetic coords meanwhile.",
  }),
  Object.freeze({
    id: "p2-photo-upload",
    priority: "P2",
    persona: "regular",
    writes: "image",
    summary: "Photo upload: check-in with 1 image → visible in gallery",
    steps: [
      "Bootstrap agent-qa-regular session via magic link",
      "POST /api/images/upload {size} → 200 {imageUuid, uploadUrl}; PUT the WebP bytes to uploadUrl; record ledger + quota (image 1)",
      "POST /api/checkins {cafe_id: seed, scores:{overall}, photo_ids:[imageUuid]} → 201; record ledger + quota (checkin 1)",
      "GET /api/cafes/[seed]/checkins → new check-in carries the photo reference",
      "Cleanup: DELETE the check-in (image originals age out via storage lifecycle — scaffold plans images as skip)",
    ],
    verdict: {
      deterministic: [
        "upload intent returns imageUuid + uploadUrl (200)",
        "PUT to uploadUrl succeeds (2xx)",
        "check-in POST returns 201 with the photo attached",
        "cafe feed entry references the photo; cleanup DELETE returns 200",
      ],
      semantic: [
        "does the gallery render the uploaded image (not a broken tile)?",
        "is the upload→attach latency within the round budget?",
      ],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS, IMAGE_SERVICE_STAGING],
  }),
  Object.freeze({
    id: "p3-maps-link-import",
    priority: "P3",
    persona: "regular",
    writes: "cafe",
    summary: "Maps-link import: POST /api/places/resolve with a fresh Turnstile token",
    steps: [
      "Bootstrap agent-qa-regular session via magic link",
      "Render the cafe-create surface so the places-resolve widget mints a fresh token",
      "POST /api/places/resolve {maps_share_url, cf-turnstile-response} → 200 POI (record ledger on creation) or 403 bot_verification_failed",
      'On 403 without a widget-minted token: verdict is "Turnstile blocked" (expected per issue table — never bypass, never forge)',
    ],
    verdict: {
      deterministic: [
        "with a widget-minted token the call reaches the worker (200 POI or upstream 502 when GOOGLE_PLACES_KEY is absent)",
        "without/forged token the route answers 403 bot_verification_failed (verified live)",
        'a 403 verdict is recorded as "Turnstile blocked", not a product defect',
      ],
      semantic: ["does the import surface explain the failure (paste hint, retry) instead of stalling?"],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS, TURNSTILE_OBSERVATION],
  }),
  Object.freeze({
    id: "p3-social-like",
    priority: "P3",
    persona: "regular+fresh",
    writes: "like",
    summary: "Social: second persona likes the regular's check-in; helpful ordering observed",
    steps: [
      "Bootstrap agent-qa-regular session; POST a check-in on the seed cafe → checkin_id (ledger + quota)",
      "Bootstrap agent-qa-fresh-<runId> session via magic link",
      "As fresh: POST /api/checkins/[id]/like → 200 {liked:true}; GET cafe feed mode=helpful → liked entry present",
      "As fresh: POST /api/checkins/[id]/like again → 200 {liked:false} (toggle off)",
      "Cleanup: both personas delete their check-ins; fresh user disposed via Admin API",
    ],
    verdict: {
      deterministic: [
        "first toggle returns {liked:true}; second returns {liked:false}",
        "self-like by the author returns 403 self_like_forbidden (guard holds)",
        "helpful feed lists the entry while liked",
      ],
      semantic: ["does the like count update visibly on the feed card without reload?"],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS, SECOND_PERSONA],
  }),
  Object.freeze({
    id: "p3-lifecycle-delete-cafe",
    priority: "P3",
    persona: "regular",
    writes: "cafe",
    summary: "Lifecycle: delete own cafe closes the create-cafe loop",
    steps: [
      "Runs as the tail of p2-create-cafe: the created cafe is deleted with {confirm:true}",
      "Standalone fallback: create a synthetic cafe then DELETE it in the same round",
      "GET detail → 404; GET /api/search for the synthetic name → absent",
    ],
    verdict: {
      deterministic: [
        "DELETE returns 200 {ok:true}",
        "detail GET returns 404 after delete",
        "no ledger entries remain uncleaned for this journey",
      ],
      semantic: ["does the UI confirm deletion (toast/redirect) rather than stranding the user on a dead page?"],
    },
    preconditions: [ACCESS_TOKEN, SUPABASE_KEYS],
  }),
]);

/**
 * Look up a journey by id. Returns undefined (never throws) so a prompt
 * template typo degrades to "unknown journey" in the report, not a crash.
 *
 * @param {string} id journey id
 * @returns {JourneyDefinition | undefined}
 */
export function getJourney(id) {
  return AGENT_QA_JOURNEYS.find((journey) => journey.id === id);
}

/**
 * Journeys runnable now: every precondition name must be in `satisfied`.
 * Blocked journeys are reported with their missing names, never run.
 *
 * @param {string[]} satisfied precondition names holding this round
 *   (e.g. `["access-token"]`, plus `"supabase-keys"` when the triple resolves)
 * @returns {{ runnable: JourneyDefinition[], blocked: Array<{ journey: JourneyDefinition, missing: string[] }> }}
 */
export function planRound(satisfied) {
  const have = new Set(satisfied);
  const runnable = [];
  const blocked = [];
  for (const journey of AGENT_QA_JOURNEYS) {
    const missing = journey.preconditions.map((p) => p.name).filter((name) => !have.has(name));
    if (missing.length === 0) runnable.push(journey);
    else blocked.push({ journey, missing });
  }
  return { runnable, blocked };
}

/**
 * Quota keys a journey consumes — the runner records one `recordWrite`
 * per created entity against these keys (cafe/checkin/image). `like` and
 * `profile` consume no quota-tracked entity; `cafe+checkin` consumes one of
 * each; `read` consumes none.
 *
 * @param {JourneyWriteKind} writes the journey's write family
 * @returns {Array<"cafe" | "checkin" | "image">}
 */
export function quotaKeysFor(writes) {
  if (writes === "cafe+checkin") return ["cafe", "checkin"];
  if (writes === "cafe") return ["cafe"];
  if (writes === "checkin") return ["checkin"];
  if (writes === "image") return ["image"];
  return [];
}
