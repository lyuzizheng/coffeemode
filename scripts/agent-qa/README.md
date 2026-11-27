# Agent-QA scaffold (`scripts/agent-qa/`)

Deterministic, non-LLM harness an agent-QA run uses against staging
(BRAWUKA-408): Cloudflare Access injection, session bootstrap, personas,
ledger, allowlist guard, quotas, cleanup.

## Closed-beta gate: staging runs `BETA_MODE=0` (BRAWUKA-1043)

The product ships gated (`web/config/app.yaml` → `beta.enabled: true`) and the
staging deployment opens it: the staging application carries `BETA_MODE=0` in
its environment. A gate-on staging refuses the part
of the matrix that cannot be admitted — `p0` (anonymous discovery is replaced
by the beta surface, `/api/cafes` answers 401 before the handler), `p2-search`
(anonymous `GET /api/search` answers 401), and `p3-social-like` (a per-run
second identity has no roster row) — so the flag is what keeps those journeys
runnable. The `regular`-persona journeys survive a gate-on round only because
that persona is on the roster.

Three consequences for a round:

- The flag is deployment environment, not repo state: it survives redeploys
  because it lives in the deployment environment. A run that sees the beta
  surface or a 401 `unauthorized` on an anonymous product route has found
  `env-failure:beta-gate-on`, not a product defect — stop and report it
  instead of spending the round.
- Never re-enable the gate to "check the beta page" during a journey round.
  The gate's own states are covered by `web/tests/integration/http-beta-gate`
  and `web/scripts/beta-gate-e2e.mjs` (production build, `BETA_MODE=1`). If an
  acceptance window does need a gated deployment, gate admission comes from
  `beta_allowlist` in the staging PostGIS database: the persistent
  `agent-qa-regular@coffeemode.test` persona is on that roster, and a per-run
  `agent-qa-fresh-<runId>` identity is not — it needs a row first, and that row
  must be revoked when the window closes so the roster keeps only live invites:

  ```bash
  node web/scripts/beta-allowlist.mjs add "agent-qa-fresh-<runId>@coffeemode.test" \
    --note "agent-QA round <runId>"
  node web/scripts/beta-allowlist.mjs remove "agent-qa-fresh-<runId>@coffeemode.test"
  ```

  (`web/scripts/beta-allowlist.mjs` is the CLI; `(cd web && npm run
  beta:allowlist -- <args>)` is the same entry point.) There is no roster
  write inside this harness, and none may be added: the roster lives in the
  application database (ADR-0010 §1), not in Supabase.
- A gate-on window must close before the nightly round: flip back to `0`,
  confirm the flipped-back state on the deployment, and drop any per-run roster
  rows. Nothing serializes the two, so a forgotten flip reproduces
  `env-failure:beta-gate-on` for the whole anonymous matrix.

The edge ruleset is generated from `beta.enabled`, not from `BETA_MODE`, so a
`BETA_MODE`-only flip changes neither the ruleset nor its purge obligation
(`docs/design/beta-gate-v1.md` §9): staging keeps its anonymous document
bypass while it runs gate-off, responses simply miss shared cache, and the
failure the bypass prevents — a cached shell outliving the gate — cannot
happen. Editing `beta.enabled` is the two-step operation, not this flag.

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
space on it. A session `CF_Authorization` scoped to the parent domain came
along; Cloudflare sends one same-name cookie, the parent-domain one won, and
every Document navigation answered 302 while the host-only cookie the runner
had stamped sat unused.

`access-cookie.mjs` makes the failure unrepresentable in two moves:

1. **Dedicated profile.** Create the QA space with
   `taskSpace(name, { profileId: resolveAgentQaProfile(await profiles()).id })`
   — ego lite's built-in `Default` profile, never Owner's imported `Profile 1`.
   A missing profile aborts as `env-failure:qa-profile-missing`; there is no
   fallback. This is also what makes step 2 safe: a parent-domain cookie in
   the personal profile may be Owner's production Access session.
2. **One canonical cookie, verified.** `ensureSingleAccessCookie(page, {
   stagingUrl, pair })` accepts only `AGENT_QA_CREDENTIAL_ORIGIN`: the URL's
   scheme, host, and port must match it exactly, and the protocol must be
   `https:` — a `blob:` URL serializes the inner origin, so it is refused
   before any cookie or request. An Access tenant host, an alternate port, or
   plaintext aborts the same way. It then deletes every `CF_Authorization`
   that would reach the staging host without being host-only at path `/` —
   parent domains, dotted host domains, and same-name cookies on other paths
   (scoped `Network.deleteCookies`, never a profile-wide clear) — trades the
   token pair for a fresh value with a direct Node fetch, stamps it with
   `Network.setCookie({ url })` — no `domain`, which is what keeps it
   host-only — then reads the whole jar back and asserts exactly one canonical
   cookie. Matching follows RFC 6265 §5.4: a bare domain is host-only and
   matches only its exact host, so a host-only cookie on the parent domain is
   never touched. Any violation throws the
   `env-failure:access-cookie-shadowed` signature instead of spending a journey
   round on the login page. The token-pair fetch keeps the probe's own client
   identity (no user-agent override) and never impersonates a browser. A bot
   challenge — HTTP 403/429/503 or any `cf-mitigated` header — stops the round
   with `env-failure:access-probe-blocked`; the runner records the blocked
   access and ends the round instead of retrying or spoofing.

`verifySingleAccessCookie(page, stagingUrl)` re-checks the invariant on its own
and is cheap enough to call before each journey; the bootstrap returns only
the purged domains, never a value or token.

Verified on this machine 2026-11-25 against the real Chromium jar in the
`Default` profile: a stamped parent-domain decoy is detected and deleted, the
jar reports every coexisting same-name cookie (including one scoped to
`/api`), and after `ensureSingleAccessCookie` the jar holds exactly one,
host-only on the staging origin at path `/`. Plaintext, an alternate port, an
unconfigured Access tenant, and a sibling staging host are each refused with
zero requests and zero cookie writes.

## Manifest fetch redirects under Access: expected only on a verified 302 (BRAWUKA-1044)

The harness cannot authenticate the manifest fetch: `Manifest` is one of the
resource types this ego-browser build rejects in `Fetch.enable` (see
`ACCESS_FETCH_RESOURCE_TYPES`), so a manifest request never pauses for token
injection, and the browser sends it without the session cookie (CDP,
2026-11-27 round).

The rule: a manifest GET that misses the cookie is expected ONLY when the
observed same-origin response is HTTP 302 to the configured Access login.
Read the response status and target from the network events, record them, then
continue the journey. A 200 means the fetch carried credentials and is not a
failure. Any other outcome — 4xx/5xx, a redirect to another target, or no
observed response — is not this exception and stops the round. The cookie
invariant still covers Document navigations and every other same-origin
subresource the harness intercepts. F10 governs only how the redirect is
reported in the console; it does not relax this check.

Policy evidence and the deployment read live on the private issue
(BRAWUKA-1044), not here.

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
