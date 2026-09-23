# 0009. Edge Header Trust — `x-forwarded-proto`

## Status

Accepted

## Context

BRAWUKA-642 (split out of the AUDIT-S2 optimization list, BRAWUKA-472 /
BRAWUKA-383) flagged that two server modules derive the request scheme from the
`x-forwarded-proto` request header, and asked for the deployment side to be
confirmed: does Traefik overwrite the header, or does a client-supplied value
reach the app?

- `web/lib/site-origin.ts` `getRequestOrigin()` — the canonical origin for
  absolute URLs (canonical link, `og:url`, `og:image`, sitemap, robots, JSON-LD).
  It reads the header whenever `NEXT_PUBLIC_SITE_URL` is unset. The deploy
  templates pin that variable (`deploy/dokploy/.env.staging.example`,
  `deploy/dokploy/.env.prod.example`), but whether the Dokploy app envs actually
  carry it is not recorded in this repo — `docs/agent/current-state.md` lists it
  as unset and the owner action in `docs/agent/pending-user-actions.md` §1 is
  still open — so the header path is live, not hypothetical.
- `web/lib/security/origin.ts` `getProtoHost()` — reconstructs the OAuth
  `redirectTo` origin when the request carries no `Origin` header. Its caller
  (`web/lib/auth/actions.ts` `getRedirectTo`) additionally requires the result to
  pass `isAllowedOrigin()`, and falls back to `getConfiguredOrigin()`.

Neither reads `x-forwarded-host` (BRAWUKA-282 P1-1). This ADR answers, for
`x-forwarded-proto`, the same question the audit's blind spot #3 raised for the
`cf-*` family; those headers are separate findings (see *Not covered*).

## Decision

`x-forwarded-proto` is a trusted input on every path that can reach the web
container. No whitelist, no config-only fallback, no code change.

The web container publishes no host port and is attached only to
`coffeemode-staging-network` / `coffeemode-prod-network` plus the shared
`traefik-net` (`deploy/dokploy/docker-compose.staging.yml`,
`deploy/dokploy/docker-compose.prod.yml`), so a request reaches it through
exactly two hops — and each hop either overwrites the header or passes an
already-overwritten value through:

| Hop | Behaviour | Evidence |
| --- | --- | --- |
| Cloudflare edge — the public path; `cafemood.app` and `staging.cafemood.app` resolve to Cloudflare, and the tunnel terminates at `cloudflared-staging` / `cloudflared-prod` | **Overwrites.** "For incoming requests, the value of this header will be set to the protocol the client used (`http` or `https`). If the client set a different value, it will be overwritten." | Cloudflare docs, *HTTP headers* → `X-Forwarded-Proto` |
| `cloudflared` tunnel client | **Passes through.** `httpService.RoundTrip` rewrites only the request URL and, when `originRequest.httpHostHeader` is set, `X-Forwarded-Host`; `X-Forwarded-Proto` is never touched. | `cloudflare/cloudflared` `ingress/origin_proxy.go` |
| Traefik — the direct-to-VPS path on :80/:443, and the tunnel's own hop when its ingress rule targets Traefik | **Deletes, then re-sets.** Dokploy's default static config emits no `forwardedHeaders` block, so `insecure` is `false` and `trustedIPs` is empty; `XForwarded.ServeHTTP` then calls `DeleteXForwardedHeaders(r.Header)` before `rewrite()` re-sets `X-Forwarded-Proto` from the connection's TLS state — `https` on the `websecure` entrypoint, `http` otherwise. | `traefik/traefik` `pkg/middlewares/forwardedheaders/forwarded_header.go` (verified on v3.6.25, the version Dokploy pins); Dokploy `packages/server/src/setup/traefik-setup.ts` `getDefaultTraefikConfig` |

Both call sites already fail closed on anything that is not an explicit `http`
(`getProtoHost`) or on a missing header (`getRequestOrigin` defaults to `https`),
so the header can only ever downgrade the scheme to `http`, and only when the
request genuinely arrived over plain HTTP.

### Re-verification

The Traefik row rests on the VPS's static config, which is not in this repo and
was not read while writing this ADR (no access to the VPS from the agent
environment). Re-check it before editing `/etc/dokploy/traefik/traefik.yml` on
the VPS, and after any Dokploy upgrade:

```bash
docker exec dokploy-traefik cat /etc/traefik/traefik.yml | grep -A3 forwardedHeaders   # expect: no match
```

End-to-end probe from a host that can reach the VPS directly — bypassing
Cloudflare Access, which fronts staging — expecting an `https://` origin:

```bash
curl -sk --resolve staging.cafemood.app:443:<VPS_IP> \
  -H 'X-Forwarded-Proto: http' https://staging.cafemood.app/robots.txt | grep Sitemap
```

## Consequences

- BRAWUKA-642 closes as "source trusted", not as an accepted unverified
  assumption.
- Residual risk: the trust rests on Dokploy's Traefik static config. If
  `forwardedHeaders.insecure: true` or a `trustedIPs` list covering the tunnel is
  ever added, a client-supplied `x-forwarded-proto` reaches the app. The blast
  radius is the scheme only: `getRequestOrigin` would mint `http://` canonical /
  OG / sitemap URLs until `NEXT_PUBLIC_SITE_URL` is pinned (DG110), and
  `getProtoHost` would hand the OAuth flow an `http://` redirect origin — the
  host still has to pass `isAllowedOrigin`.
- Not covered: `cf-connecting-ip` (P3-1) and `cf-ipcity` (P3-8). Traefik strips
  only the `X-Forwarded-*` family, so the direct-to-VPS path can still forge
  those; they are separate findings with their own fixes. `x-forwarded-host`
  stays untrusted (BRAWUKA-282 P1-1).

## Related

- `docs/specs/0001-nextjs-migration.md` — origin allowlist and OAuth redirect rules
- `docs/specs/0005-dokploy-vps-and-deployment-architecture.md` — ingress topology
- [0004-server-log-request-id.md](./0004-server-log-request-id.md) — the same
  trust-boundary question for `x-request-id`
- BRAWUKA-642 (this item), BRAWUKA-472 and BRAWUKA-383 (AUDIT-S2)
