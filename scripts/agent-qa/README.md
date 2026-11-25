# Agent-QA scaffold (`scripts/agent-qa/`)

Deterministic, non-LLM harness an agent-QA run uses against staging
(BRAWUKA-408): Cloudflare Access injection, session bootstrap, personas,
ledger, allowlist guard, quotas, cleanup.

## Cloudflare Access: per-origin injection (BRAWUKA-508)

`CF-Access-*` is a network-layer identity: it MUST reach only
`AGENT_QA_ACCESS_HOSTS` (`allowlist.mjs`) — the Access-protected subset
(staging app, image CDN, Access handshake hosts). The staging Supabase host
stays in the navigation allowlist (`AGENT_QA_ALLOWED_HOSTS`) but is NOT an
Access host, so it never receives the token pair (BRAWUKA-593). The old path —
`Network.setExtraHTTPHeaders` via `toCdpExtraHeaders` — attaches headers to
_every_ request the page makes, leaking the service token to third parties
(`cloudflareinsights.com` beacons failed CORS preflight; `openfreemap` tiles
carried the token). That API is global by design and MUST NOT be used for
`CF-Access-*`; the shape helpers in `access-headers.mjs` remain only for
scaffold-side direct HTTP calls to already-allowlisted staging URLs.

The browser path is `access-inject.mjs`: `Fetch.enable` with urlPatterns
scoped to the Access hosts AND to subresource `resourceType`s
(`buildAccessFetchPatterns`: no `Document`, only types this ego-browser build
accepts — `TextTrack`/`Prefetch`/`WebSocket`/`Manifest`/`SignedExchange`/
`Preflight`/`FedCM` are rejected at enable time), plus a `page.events()`
drain pump (`createAccessRequestPump`) that merges the token pair into paused
subresource requests (`Fetch.continueRequest`) and passes everything else
through untouched.

Status (ego-browser 0.5.0.32, verified end-to-end on this machine 2026-09-19
against a local echo server): subresource injection WORKS. A paused XHR
continued via `page.cdp("Fetch.continueRequest", …)` with merged headers
arrives at the server carrying the token pair — reproduced with the full
33-pattern set (3 Access hosts × 11 types). Documents never pause under the
patterns, so `page.goto()` resolves in ~100ms.

Two real caveats: (a) `page.fetch` must never target an intercepted URL —
its paused event carries a requestId `page.cdp()` cannot continue (`Invalid
InterceptionId`, request hangs); scaffold HTTP calls use direct Node fetch
and in-page reads use fire-and-poll (`window.__x`), so both stay off this
path. (b) The top-frame Document navigation carries no Access headers, so
the first staging `page.goto()` lands on the Access handshake; the agent
completes it once and reuses the session cookie thereafter. Ordering (BRAWUKA-409 F9):
cookie bootstrap is the PRIMARY path — a Node fetch with the
`CF-Access-Client-*` pair trades for a `CF_Authorization` cookie stamped via
`Network.setCookie` before navigation; `Fetch` injection is fallback ONLY for
same-origin subresources that miss the cookie (paused requests hang when the
pump process exits, and Fetch-enabled navigations stalled on `load` where the
cookie-only path never stalled). Fail-closed throughout:
unparsable/off-Access-scope URLs never receive headers, and a
paused request is always continued (never left hanging).

## Dedicated profile + one host-only cookie (BRAWUKA-1026)

The 2026-11-20 scheduled round died at the Access login page with
`env-failure:access-cookie-shadowed`. Cause: the QA browser ran on Owner's
personal ego profile, whose jar is shared with Owner's tabs and every other
space on it. A session `CF_Authorization` scoped to `.cafemood.app` came along;
Cloudflare sends one same-name cookie, the parent-domain one won, and every
Document navigation answered 302 while the host-only cookie the runner had
stamped sat unused.

`access-cookie.mjs` makes the failure unrepresentable in two moves:

1. **Dedicated profile.** Create the QA space with
   `taskSpace(name, { profileId: resolveAgentQaProfile(await profiles()).id })`
   — ego lite's built-in `Default` profile, never Owner's imported `Profile 1`.
   A missing profile aborts as `env-failure:qa-profile-missing`; there is no
   fallback. This is also what makes step 2 safe: a `.cafemood.app` cookie in
   the personal profile may be Owner's production Access session.
2. **One host-only cookie, verified.** `ensureSingleAccessCookie(page, {
   stagingUrl, pair })` deletes every `CF_Authorization` that would be sent to
   the staging host and is not host-only (scoped `Network.deleteCookies`, never
   a profile-wide clear), trades the token pair for a fresh value with a direct
   Node fetch, stamps it with `Network.setCookie({ url })` — no `domain`, which
   is what keeps it host-only — then reads `Network.getCookies` back and asserts
   exactly one. Any violation throws the `env-failure:access-cookie-shadowed`
   signature instead of spending a journey round on the login page. The
   token-pair fetch presents the live Chromium user agent (constant fallback):
   the staging bot layer challenges a non-browser UA, and the 2026-11-20
   evidence proves the cookie is issued to a browser-shaped request.

`verifySingleAccessCookie(page, stagingUrl)` re-checks the invariant on its own
and is cheap enough to call before each journey; the bootstrap returns only
the purged domains, never a value or token.

Verified on this machine 2026-11-25 against the real Chromium jar in the
`Default` profile: a stamped `.cafemood.app` decoy is detected and deleted,
`Network.getCookies` reports both cookies when they coexist, and after
`ensureSingleAccessCookie` the jar holds exactly one cookie, domain
`staging.cafemood.app`.

## Secret-bridge contract (F8)

The ego-browser Node process does NOT inherit the agent's env, so
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` must be bridged explicitly:

1. The launcher writes a temporary file with `KEY=VALUE` lines
   (`0600`, `mktemp`), containing only the two `CF_ACCESS_*` variables.
2. The scaffold reads it at start via `loadAccessEnvFile`, which deletes the
   file immediately after reading, then resolves fail-closed
   (`resolveAccessHeaders` throws on any missing variable — the run aborts
   before touching staging instead of probing it unauthenticated).
3. Secrets never enter the transcript, a prompt, page content, or the client
   bundle. The Supabase `service_role` key stays server-side
   (`scripts/agent-qa/session.mjs`) under the same rule.

## Journey registry (BRAWUKA-411)

`journeys.mjs` (`AGENT_QA_JOURNEYS` + `planRound` + `getJourney` +
`quotaKeysFor`) is the journey list's single source of truth: the autopilot
prompt states only orchestration rules and reads the registry per round, so
the matrix expands journey-by-journey without prompt rewrites. Each journey
declares persona, write family, steps, deterministic + semantic verdict
assertions, and preconditions up front. `planRound(satisfied)` splits
runnable from blocked — blocked reports missing precondition names and is
never filed as a defect. Live-grounded notes: P2 search narrows on
`wifi`/`coffee` (seed dim avg 51; `outlets` has no rated rows, skipped);
`POST /api/places/resolve` without a widget-minted token answers 403
(`Turnstile blocked` is the verdict, never a bypass).

## Preconditions are computed, never inferred (BRAWUKA-955)

`planRound(satisfied)` takes its input from `preconditions.mjs`. The runner
executes this first and passes the printed `satisfied` array verbatim:

```bash
node scripts/agent-qa/preconditions.mjs
```

```json
{
  "satisfied": ["access-token", "supabase-keys"],
  "missing": [],
  "unverified": ["image-service-staging", "turnstile-present", "second-persona"],
  "missingVariables": {}
}
```

- `satisfied` — the env contract resolves; the precondition holds.
- `missing` — the contract does not resolve. `missingVariables` names the
  exact variable(s) at fault. Names only: the script never prints a value.
- `unverified` — no env contract exists (a live probe or a provisioned
  persona decides it). Not satisfied; the registry's `check` text is the
  only authority.

Names are derived from `AGENT_QA_JOURNEYS`, so a precondition attached to a
journey cannot be omitted from the report. Resolution reuses the runner's
own resolvers (`resolveAgentQaSupabaseEnv` via `supabase-env.mjs`,
`resolveAccessHeaders` via `access-headers.mjs`), so the new key names are
tried first and the legacy names still work during the migration window
(BRAWUKA-950).

Why it exists: the set used to be re-judged by the agent every round from
prompt prose. When the API keys were renamed, that prose still named the
retired variables, so `supabase-keys` reported missing while the triple
resolved — seven journeys blocked with no defect behind it. A hand-built
`satisfied` set is never acceptable input to `planRound`.

Exit code 0 means the evaluation ran (`missing`/`unverified` are data, not an
error); 2 is a usage error.
