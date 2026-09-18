# Agent-QA scaffold (`scripts/agent-qa/`)

Deterministic, non-LLM harness an agent-QA run uses against staging
(BRAWUKA-408): Cloudflare Access injection, session bootstrap, personas,
ledger, allowlist guard, quotas, cleanup.

## Cloudflare Access: per-origin injection (BRAWUKA-508)

`CF-Access-*` is a network-layer identity: it MUST reach only
`AGENT_QA_ALLOWED_HOSTS` (`allowlist.mjs`). The old path —
`Network.setExtraHTTPHeaders` via `toCdpExtraHeaders` — attaches headers to
_every_ request the page makes, leaking the service token to third parties
(`cloudflareinsights.com` beacons failed CORS preflight; `openfreemap` tiles
carried the token). That API is global by design and MUST NOT be used for
`CF-Access-*`; the shape helpers in `access-headers.mjs` remain only for
scaffold-side direct HTTP calls to already-allowlisted staging URLs.

The browser path is `access-inject.mjs`: `Fetch.enable` with urlPatterns
scoped to the allowlist AND to subresource `resourceType`s
(`buildAccessFetchPatterns`: no `Document`, only types this ego-browser build
accepts — `TextTrack`/`Prefetch`/`WebSocket`/`Manifest`/`SignedExchange`/
`Preflight`/`FedCM` are rejected at enable time), plus a `page.events()`
drain pump (`createAccessRequestPump`) that merges the token pair into paused
subresource requests (`Fetch.continueRequest`) and passes everything else
through untouched.

Status (ego-browser 0.5.0.32, verified on this machine 2026-09-19): the scope
is correct but NOT YET USABLE. `Fetch.enable` with subresource-only patterns
is proven — `page.goto()` resolves in ~100ms with zero Document pauses
buffered — but every `Fetch.continue*` through `page.cdp()` returns
`Invalid InterceptionId` for paused subresources (XHR, Image incl. `new
Image()` tags; same for `fulfillRequest`/`failRequest`/`continueWithAuth`),
and the request hangs until its own timeout. `Fetch.disable` does not release
paused requests. The interception belongs to an internal CDP session the
command channel cannot continue.

Safe operating point today: do NOT `Fetch.enable` on a journey page.
Per-origin injection stays open, blocked on the ego-browser interception fix;
the global `setExtraHTTPHeaders` path stays retired regardless (F6). First
staging `page.goto()` is unauthenticated and lands on the Access handshake;
the agent completes it once and reuses the session cookie. Fail-closed
throughout: unparsable/off-allowlist URLs never receive headers, and a paused
request is always continued (never left hanging) once continuation works.

Caution: never use `page.fetch` for an allowlisted URL while `Fetch.enable`
is active — it hangs on the same interception (`Invalid InterceptionId` on
continue). Scaffold HTTP calls use direct Node fetch, so they are off this
path.

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
   (`web/tests/agent-qa/session.ts`) under the same rule.
