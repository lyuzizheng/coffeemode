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
scoped to the allowlist (`buildAccessFetchPatterns`) plus a `page.events()`
drain pump (`createAccessRequestPump`) that merges the token pair into paused
subresource requests (`Fetch.continueRequest`) and passes everything else
through untouched. Verified against ego-browser: `page.cdp()` supports the
Fetch domain, subresource pauses continue fine — but a paused top-frame
Document navigation never resolves its `goto()` commit waiter (an ego-browser
CDP-session limitation, not our headers), so the Document navigation is
deliberately NOT intercepted.

Consequence: the first `page.goto()` to staging carries no Access headers and
lands on the Access handshake page; the agent completes it once (or reuses a
session cookie), and every subsequent same-origin subresource fetch carries
the token pair. Fail-closed throughout: unparsable/off-allowlist URLs never
receive headers, and a paused request is always continued (never left hanging).

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
