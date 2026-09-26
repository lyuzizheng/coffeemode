# Pending User Actions

Things only the repo owner can provide or approve — account creation, credential
provisioning, dashboard toggles, and approval of agent-drafted design artifacts
(spec 0004 decision 6b). The agent cannot perform these. Credentials are never
pasted into chat, docs, or the repo; put them in `~/.zshrc` or `web/.env.local`
and say "配好了" — the agent reads them itself and never echoes them back.

Status legend: `[ ]` needed, `[~]` partially done, `[x]` done.

## 1. Supabase (auth provider) — unlocks auth round-trip

- [x] Project exists; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are in `~/.zshrc` (owner 2026-09-23: staging project live)
- [ ] Set public site / allowlist env vars from `web/.env.example`:
  - `NEXT_PUBLIC_SITE_URL` (required, e.g. `http://localhost:3000`, no trailing slash)
  - `NEXT_PUBLIC_ALLOWED_HOSTS` (optional, comma-separated, e.g. `localhost:3001`)
- [x] Copy the **publishable public key** (new-style `sb_publishable_…`; env/secret names keep the legacy `*_ANON_KEY` naming — supabase-js 2.112 / ssr 0.12 compatible, no code change): Dashboard → Project Settings → API Keys → publishable key (formerly `anon public`) → into `web/.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY` (owner 2026-09-23: staging key in place)
- [x] Redirect URLs allowlist (owner 2026-09-23: staging + local callback URLs in place): Dashboard → Authentication → URL Configuration → Redirect URLs → add `${NEXT_PUBLIC_SITE_URL}/auth/callback` and the `/auth/callback` URL for every host in `NEXT_PUBLIC_ALLOWED_HOSTS`. At minimum:
  - `${NEXT_PUBLIC_SITE_URL}/auth/callback` (e.g. `http://localhost:3000/auth/callback` or `https://<production-domain>/auth/callback`)
  - `http://localhost:3001/auth/callback` (if you add `localhost:3001` to `NEXT_PUBLIC_ALLOWED_HOSTS`)
  - any staging/preview domains you add to `NEXT_PUBLIC_ALLOWED_HOSTS`
- [x] Enable **Google** provider: Dashboard → Authentication → Providers → Google → paste Google OAuth client id/secret (from item 3 below) (owner 2026-09-23: enabled on staging)
- [ ] Enable **Apple** provider later (needs item 4)

## 1a. Staging journey secrets (GitHub Environment `staging`) — unlocks post-merge staging verification

- [x] Ephemeral runner-local Postgres (`postgis/postgis:16-3.4`) started via `docker compose -f ../docker-compose.yml up -d --wait postgres`, with `STAGING_DATABASE_URL` hardcoded to `postgresql://coffeemode:coffeemode@localhost:5432/coffeemode` in `.github/workflows/staging-journey.yml` (BRAWUKA-525). Dokploy CI Postgres (`coffeemode-ci-postgres`) and Cloudflare Tunnel (`ci-db.cafemood.app`) path superseded and scheduled for decommission.
- [x] GitHub Environment `staging` secrets cleanup: remove `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, and `STAGING_DATABASE_URL` (no longer needed by staging-journey). Retain `SUPABASE_URL` (= `https://ojujmjewtbquiddswyrg.supabase.co`) and `SUPABASE_ANON_KEY` for auth smoke checks. (`SUPABASE_ANON_KEY` value updated 2026-09-23 to the new-style publishable key — secret name unchanged.)
- [ ] (Optional, for real-session journey suites) Staging Supabase project dashboard → Settings → API: copy `service_role` key into GitHub Environment `staging` as `SUPABASE_SERVICE_ROLE_KEY`. (Staging CI verification currently passes using `SUPABASE_ANON_KEY` for auth smoke verification.)
- [x] Redirect URLs allowlist on the **staging** project (spec 0010 §1): `http://localhost:3000/auth/callback` (local dev against staging auth) + `https://staging.cafemood.app/auth/callback`. (owner 2026-09-23: done)
- [x] Confirm Google provider is enabled on the **staging** project (item 3's client works for both; the Supabase callback `https://ojujmjewtbquiddswyrg.supabase.co/auth/v1/callback` must be in the Google client's authorized redirect URIs). (owner 2026-09-23: done)
- [ ] Dokploy staging app env still needs the publishable key by hand (2026-09-23, Dokploy MCP unreachable): set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the `sb_publishable_…` value in the Dokploy UI and rebuild — `NEXT_PUBLIC_*` is inlined into the client bundle.
- [ ] `production` environment: owner (`lyuzizheng`) is the required reviewer (already set); prod secrets land there only at promotion time, never before.

## 2. Postgres (primary database — Supabase, per 0004 decision 34a, owner 2026-08-28)

- [x] Create the Supabase project (free tier) in the region closest to the VPS (CafeMood project `rsdzcegylqgccaneomph` active in `ap-southeast-1`)
- [x] Enable PostGIS in the SQL editor: `CREATE EXTENSION postgis;` (automated & verified via `scripts/devops/provision-supabase.sh`)
- [x] Apply the schema with the session/direct connection (not the transaction pooler): `DATABASE_URL=<session-conn> npm run db:migrate` (all 19 migrations 0001–0019 applied; automated via `scripts/devops/provision-supabase.sh`)
- [x] ~~Put the pooled connection string into the VPS env as `DATABASE_URL`~~ Superseded 2026-09-20 (BRAWUKA-507): staging app data moved off Supabase to Dokploy VPS Postgres `coffeemode-staging-db`; `DATABASE_URL` now points at the `dokploy-network` internal `:5432` (`sslmode=disable`). Prod still needs the Supabase pooled string when it deploys (BRAWUKA-500).
- [~] 已迁 VPS cron: nightly recompute 与 Helpful ranking 快照已迁至 Dokploy 定时任务（02:00 UTC，BRAWUKA-475），DATABASE_URL 仅在 VPS env 保留，无需进 GitHub secrets。**2026-09-21（BRAWUKA-598）：调度已停用** —— 它挂在从未部署过的 `coffeemode-web-prod` 上（BRAWUKA-500，Owner 已决定暂不部署），Dokploy 每次都在容器查找阶段中止（`Container not found`），命令根本没执行。prod 容器起来后随 BRAWUKA-500 一并重新启用；prod env 另缺 `DATABASE_URL` 与 `MULTICA_AUTOPILOT_WEBHOOK_URL`，两者都是该 job 的必需项
- [x] 定时任务失败告警自愈接线（BRAWUKA-476）：Dokploy env 配置 `MULTICA_AUTOPILOT_WEBHOOK_URL`，并在 Dokploy Notifications 挂载 Custom Webhook（兜底平台与构建异常）；非零退出时 POST 触发 CoffeeMode 运维告警自愈 autopilot 自动建单
- [x] Verify product tables are NOT reachable via the Supabase Data API (PostgREST) with the browser publishable key — all application tables have RLS enabled and grants revoked from `anon` & `authenticated` (verified via `scripts/devops/provision-supabase.sh`)
- [ ] Free-tier cliffs: 500MB DB then read-only (seed negligible today — 14 cafes; re-measure before any bulk import), 5GB egress (images stay on R2), no backups — schedule `pg_dump` to R2 as the cheap mitigation

## 3. Google OAuth (Sign in with Google) — unlocks real login

- [x] console.cloud.google.com → project + OAuth consent screen (External, test users OK for now) (owner 2026-09-23: done)
- [x] Credentials → OAuth client ID (**Web application**) → Authorized redirect URI carries the Supabase Auth callback URL from Dashboard → Authentication → Providers → Google (e.g. `https://<project-ref>.supabase.co/auth/v1/callback`) (owner 2026-09-23: done)
- [x] Put client id/secret into the Supabase dashboard (item 1) — not into the repo (owner 2026-09-23: provider enabled on staging)

## 4. Apple Sign-In — deferred until Apple Developer Program

- [ ] Buy Apple Developer Program membership ($99/yr) — also needed for MapKit JS (blocks Apple-only slices, not cafe creation's link/Google paths; #131)
- [ ] Configure Services ID + Sign in with Apple key, then enable Apple provider in Supabase (item 1)

## 5. Google Places API key — for poi-cache-service deploy

- [ ] console.cloud.google.com → enable **Places API (New)** → create API key → restrict to that API + (later) IP/HTTP referrers
- [ ] The key goes ONLY into the POI Worker (`poi-service/.dev.vars`, never committed). Next.js never sees it.

## 5a. Cloudflare Turnstile widget + keys — for anonymous `POST /api/places/resolve` (BRAWUKA-239)

- [x] Create the Turnstile widget (done 2026-09-23 via Cloudflare API, BRAWUKA-680): widget `cafemood_places_resolve`, Managed mode, domains `cafemood.app` / `staging.cafemood.app` / `www.cafemood.app` / `localhost` / `127.0.0.1` / `brabalawuka.cloudflareaccess.com` (free, unlimited validations; the Access login host is included so the challenge loads behind Cloudflare Access)
- [ ] Put the secret into the app env as `TURNSTILE_SECRET_KEY` (server-only; VPS env / secrets manager — never `NEXT_PUBLIC_*`, never chat/docs/repo) and the sitekey as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (rebuild after setting — Next inlines it into the client bundle). The widget above already exists — only this env fill remains (Dokploy MCP unreachable 2026-09-23, needs the owner in the Dokploy UI; `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` presence in the staging env unconfirmed). Dev/test without keys skip verification; production without `TURNSTILE_SECRET_KEY` fails closed (403 `bot_verification_failed`)
- [ ] Verify: anonymous `POST /api/places/resolve` without/forged token → 403; real browser link-import flow → 200

**Only remaining owner item for the POI service** (2026-09-12, BRAWUKA-222): the four
Cloudflare resources, both migrations, both deployments and both `POI_SERVICE_TOKEN`
secrets are done. Until this key is installed on both Workers
(`wrangler secret put GOOGLE_PLACES_API_KEY --env staging|production`, or the equivalent
Cloudflare API call), `/poi/:place_id`, the query path of `/poi/resolve`, and
`/poi/autocomplete` answer 502 `upstream_error`; `POST /poi/external` → `GET /poi/search`
and the KV hot-cache read path are unaffected and verified working.

The key must be authorized for **Places API (New)** only — the live search path is
Autocomplete (New) + Place Details (New) (BRAWUKA-602) and no longer calls Text Search,
so a key restricted to the legacy Places API would 403 every live search.

## 6. image-service deploy

- [x] Create R2 bucket and S3 API token for image uploads (`coffeemode-images-prod` and `coffeemode-images-staging` provisioned in APAC with CORS configured)
  - The CORS origins were provisioned pre-rename as `coffeemode.app` / `staging.coffeemode.app`, so the 2026-09-14 rename to `cafemood.app` silently broke every browser presigned PUT (`403 CORS not configured for this bucket`) — BRAWUKA-560. Corrected 2026-09-23 on both buckets to `cafemood.app`, `www.cafemood.app`, `staging.cafemood.app`, `localhost:3000`. `scripts/devops/bootstrap.sh` now verifies the CORS API response and aborts on rejection instead of discarding it with `|| true`.
- [x] Set the per-environment values in `image-service/wrangler.toml` `[env.production]` / `[env.staging]` (the top-level `[vars]` stay as the local-dev defaults and are never deployed)
- [x] Deployed image-service (workers `image-service-prod` / `image-service-staging`; redeploys go through the guarded `npm run deploy -- --env staging|production`):
  - Secrets installed via Cloudflare Worker bindings (`IMAGE_SERVICE_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)
  - Deployed to `https://image-service-prod.lyuzizheng.workers.dev` (production) and `https://image-service-staging.lyuzizheng.workers.dev` (staging)
  - `IMAGE_SERVICE_URL` and `IMAGE_SERVICE_TOKEN` recorded in local `web/.env.local`
- [ ] Attach custom domains `images.cafemood.app` and `staging-images.cafemood.app` to `coffeemode-images-prod` and `coffeemode-images-staging` R2 buckets (zone `cafemood.app` active; records go in via BRAWUKA-236/238, issue #142)
- [ ] Configure bucket defenses:
  - Set a maximum upload size (Cloudflare WAF / R2 bucket limits or a `Content-Length`-enforced presigned URL) to mitigate abuse.
- Orphan cleanup (issue #158, hardened BRAWUKA-400): do NOT add a blanket R2 lifecycle expiry on
  `original/` — completed gallery originals share that prefix. Instead schedule
  `image-service/scripts/clean-orphan-originals.mjs` (e.g. daily cron or GitHub
  scheduled workflow via #154) with least-privilege R2 credentials that allow
  List/Head/Delete on `original/` and List/Delete on `staging/` (BRAWUKA-730:
  the sweep now also removes stale browser-written staged uploads by age alone,
  so its credential scope must include that prefix too). Each run is two steps:
  1. `DATABASE_URL=... node web/scripts/export-live-image-keys.mjs > /tmp/live-keys.txt`
     (read-only; exports every `original/` key still referenced by live
     `cafes.gallery` / `checkins.photos`).
  2. First run with `LIVE_KEYS_FILE=/tmp/live-keys.txt DRY_RUN=1
  RETENTION_DAYS=7`, review the JSON output, then set `DRY_RUN=0`. The script
  deletes marker-less originals and provision-stage uploads that were never
  attached AND are absent from the live-keys export; post-commit attach
  (BRAWUKA-400) re-marks live originals to `checkin`, and any stale-marker
  key that IS referenced is reported as `would-keep … reason:"referenced"`
  and never deleted. A failed sibling keeps its original as the retry anchor
  (siblings-first delete order), so the next scheduled run re-attempts it.
  `staging/` objects need no export, marker, or HEAD: anything past
  RETENTION_DAYS there is garbage (`stagingCandidates`/`stagingDeleted` in the
  output), far outside the 1-hour upload-intent window a retry needs.
- Tombstone retry path (BRAWUKA-699): the sweeper never sees tombstoned
  rows' variants (it lists `original/` orphans only), so a `deleteUnreferencedPhotos`
  failure after a check-in/cafe/account delete converges only through
  `web/scripts/backfill-tombstone-photo-deletes.mjs` — re-run it alongside the
  sweeper (same cadence) until it reports no failures:
  `DATABASE_URL=... IMAGE_SERVICE_URL=... IMAGE_SERVICE_TOKEN=... node
  web/scripts/backfill-tombstone-photo-deletes.mjs` (dry-run by default),
  review, then `DRY_RUN=0`. One-shot pre-#694 residue used the same command.

## 7. Domain + deploy (later phase)

- [x] Domain registered + Cloudflare zone delegated — `cafemood.app` live with NS on emily/brodie.ns.cloudflare.com (verified 2026-09-14 via BRAWUKA-235 audit); zone currently holds zero DNS records, apex records go in via BRAWUKA-236/238
- [ ] Create proxied DNS records for `cafemood.app` / `staging.cafemood.app` (BRAWUKA-236/238 scope); Cloudflare proxy/CDN in front
- [ ] Cloudflare account for the POI worker (`poi-service.cafemood.app` once records land)
- [x] In a terminal (from `poi-service/`), create the per-environment resources and add a `[env.staging]` / `[env.production]` block to `poi-service/wrangler.toml` (spec 0005 §3 names): (done 2026-09-12, BRAWUKA-222 — created on the `Lyuzizheng@gmail.com` account via Cloudflare MCP; `wrangler.toml` now carries real ids for both environments, the top-level local-dev placeholders untouched)
  - `poi-store-staging` = `d069da6b-07e5-4fc0-b6a9-a685b3bef8b8`, `poi-store` = `7d01d154-03a7-4483-8b54-83f2c310af3b` (`POI_DB`)
  - `poi-cache-staging` = `9f7f807aa68b47e3bbb6ecaf15c5f571`, `poi-cache` = `be0e4111b70f482ca23ed1f833142f88` (`POI_KV`)
- [x] Apply the schema: `wrangler d1 migrations apply poi-store --remote` (done 2026-09-12, BRAWUKA-222 — `0001_init.sql` applied to both remote databases; `pois` + both indexes verified by remote query, and the `0001_init.sql` row recorded in `d1_migrations` so a later `wrangler d1 migrations apply` is a no-op)
- [~] Set the two worker secrets (values never go in chat/docs): `wrangler secret put POI_SERVICE_TOKEN --env production`, `wrangler secret put GOOGLE_PLACES_API_KEY --env production`
  - `POI_SERVICE_TOKEN` installed on both Workers (self-generated, 2026-09-12).
  - `GOOGLE_PLACES_API_KEY` NOT installed — still blocked on item 5. Until it is, `/poi/:place_id`, `/poi/resolve` (query path) and `/poi/autocomplete` return 502 `upstream_error`; every other path works.
- [x] Deploy: `npm run deploy -- --env production` (guarded — refuses while the placeholder ids are still configured) → workers.dev URL; wire `POI_SERVICE_URL` + `POI_SERVICE_TOKEN` into `web/.env.local` (done 2026-09-12, BRAWUKA-222 — both environments deployed and verified: `https://poi-service-staging.lyuzizheng.workers.dev`, `https://poi-service-prod.lyuzizheng.workers.dev`; `npm run deploy -- --env staging|production --check` now passes)
- [x] Worker route migration (BRAWUKA-236) — custom domains attached via Cloudflare MCP and verified:
  - `poi-service.cafemood.app` → `poi-service-prod` (/health 200)
  - `image-service.cafemood.app` → `image-service-prod` (/health 200)
  - `poi-service-staging.cafemood.app` → `poi-service-staging` (/health 200)
  - `image-service-staging.cafemood.app` → `image-service-staging` (/health 200)
  - Dokploy staging app (`coffeemode-web-staging`) updated with custom domain `POI_SERVICE_URL` / `IMAGE_SERVICE_URL` and restarted; Dokploy prod app env prepared.
  - `workers.dev` disabled across all 4 workers via Cloudflare API (`subdomain` endpoint returns enabled: false; all 4 return 404).
  - `workers_dev = false` pinned in `poi-service/wrangler.toml` and `image-service/wrangler.toml`.
  - Token auth (`x-poi-service-token` / `x-image-service-token`) verified end-to-end (401/403 without token; 200 with token).
- [ ] Enable the Cloudflare "Add visitor location headers" Managed Transform on the zone (sends `CF-IPCity` / `CF-IPCountry`; default-city resolution per DG128)
- [x] ~~Better Stack account + per-environment sources for rate-limit/observability alerts (DG129, BRAWUKA-235)~~ **Retired by BRAWUKA-611 (2026-09-21)** — the four CoffeeMode sources, both dashboards, all four chart alerts and the `coffeemood.com` uptime monitor are deleted, and the two ingest env vars are removed from both Dokploy apps (staging and prod verified clean). The rate-limit event now reaches Grafana Cloud Loki as a structured `logWarn` line (`code: "rate_limited"`) and is alerted on by `CoffeeMode — Rate-limit flood`. **No owner action remains here — do not paste ingest credentials.**
- [x] ~~Better Stack `coffeemode-api-errors` source pair for the API error/warn JSON lines (spec 0011 D8, BRAWUKA-541)~~ **Superseded by BRAWUKA-607, closed out by BRAWUKA-611** — the `api-error-sink.ts` hook and its ingest-credential pair are deleted; error / warn / access lines go to Grafana Cloud Loki over OTLP (`web/lib/observability/otlp-logs.ts`). The Better Stack sources, dashboards and chart alerts that used to receive them are now deleted too, and the replacement Grafana alert rules live in the `CoffeeMode` folder. No owner action remains here.

## 8. Kimi K3 UI design artifacts

Supply route changed (owner 2026-09-07, BRAWUKA-109; spec 0004 decision 6b): agents are
authorized to produce slice-specific K3 composition proposals autonomously and submit
them for owner review — the owner reviews, no longer authors. The per-slice artifact
gate itself (spec 0004 decision 6a) still stands.

- [x] Review PR #128's creation flow with Kimi K3 before merge. (Completed post-merge on 2026-08-23 — verdict on PR #128; follow-ups #183–#185.)
- [x] Provide a Kimi K3 discovery artifact for issue #133 covering mobile
  PEEK/HALF/FULL, desktop sidebar/detail column, compact place-characteristic
  icons, both-score hierarchy, Navigate / Check in / Share placement, the
  Helpful/Newest control, tablet landscape, failure/Retry and missing-cafe toast
  states, non-modal focus, and the accepted drag/scroll behavior. (Delivered and
  grilled as DG21–DG43; #133 implemented in PR #195.)
- [ ] Review slice-specific K3 composition proposals (agent-produced per decision 6b)
  before any new user-visible UI implementation starts.

## 9. GitHub Reviewer Bot / App (optional future enhancement)

- [ ] If GitHub-native PR review enforcement (`required_approving_review_count: 1`) is desired on branch protection:
  - Register a dedicated GitHub App or bot user (e.g. `coffeemode-reviewer-bot`) with Pull Requests read & write permissions.
  - Install it to `lyuzizheng/coffeemode`.
  - Provide its bot token to the Multica workspace for the Reviewer & Architect agent.
  - Update branch protection on `main` to require 1 approving review from that bot.
  (Until provisioned, branch protection relies on strict `ci-gate` and admin enforcement, while independent code review is verified via Multica issue verdicts per spec 0003 and closed-loop workflow).

## 10. Grafana Cloud stack (agent observability via MCP)

Agents are wired to the official Grafana Cloud MCP; it needs a stack to talk to.

- [x] ~~Deploy `mcp-grafana` (streamable HTTP) in Dokploy~~ — retired 2026-09-21. The self-hosted app `coffeemode-mcp-grafana`, its `mcp.cafemood.app` DNS record, tunnel ingress rule, Cloudflare Access app and service token were all deleted; the three local secrets were removed from `~/.config/zsh/secrets.zsh`.
- [x] Point agents at the hosted endpoint `https://mcp.grafana.com/mcp` with OAuth 2.1 + dynamic client registration — `grafana` entry in `~/.omp/agent/mcp.json`, and `hermes mcp install grafana` in `~/.hermes/config.yaml`. See `docs/devops/mcp-servers.md`.
- [ ] Create the Grafana Cloud stack (grafana.com — the free tier is enough) and grant the connecting user the `Assistant Cloud MCP User` role (Editor or higher has it by default; that covers read + query scope only — write scope needs `Assistant Admin`). Assistant must be available on the stack with its terms accepted.
- [ ] Authorize the MCP client: omp opens a browser on first connect; Hermes needs `hermes mcp login grafana`. Both ask for the stack URL (`https://<stack>.grafana.net`) and show read / query / write as three separate checkboxes. Restart the agent session afterwards so the tools load.
- [x] ~~(Optional) Decide whether the rate-limit alert sink (`web/lib/observability/rate-limit-alert.ts`, DG129) moves from Better Stack to Grafana Cloud.~~ **Decided and done (BRAWUKA-611, 2026-09-21)** — the sink is Grafana-only now; the Better Stack POST is deleted from the hook.

### Alerting notification path (BRAWUKA-611) — blocked on write scope

The six CoffeeMode alert rules exist and evaluate, but **nothing can notify yet**: the stack has no contact point at all, and the default notification policy's receiver is the built-in no-op `empty`.

**This is already costing visibility**: at 2026-09-21 13:24 UTC the uptime rule (`CoffeeMode — Uptime probe failing`, BRAWUKA-608) had been firing for ~1.5 h on a real outage — `cafemood.app` answers 502 (BRAWUKA-500) — with no notification sent.

**The cause is not a missing permission, so don't go looking for one to grant.** `GET /api/access-control/user/permissions` (identity `brabalawuka`, org 1, not a Grafana admin) lists *every* alternative the 403 names: `alert.notifications.provisioning:write`, `alert.notifications:write`, `alert.notifications.receivers:create`, `alert.notifications.routes:write`, `alert.provisioning.provenance:write`. All five write paths are still refused:

| Attempt | Result |
| --- | --- |
| `POST /api/v1/provisioning/contact-points` | 403 `Access denied` |
| `PUT /api/v1/provisioning/policies` | 403 `Access denied` |
| `POST /api/alert-notifications` (legacy) | 404 |
| `POST /api/alertmanager/grafana/config/api/v1/receivers` | 404 |
| `POST /apis/notifications.alerting.grafana.app/…/receivers` | 403 `invalid namespace` (tried `default`, `stacks-1795570`, `lyuzizheng`) |

The effective grant is narrower than the reported RBAC role — most likely the hosted MCP server's OAuth token carries a scope set that Grafana intersects with the role. So the fix is at the **MCP grant level** (the `Assistant Admin` role / re-authorizing the MCP client with write scope), not a permission to add to the user.

- [ ] Either grant the MCP connection write scope (the `Assistant Admin` role — the same grant item above asks for), or apply the two changes by hand in **Alerting → Contact points** and **Alerting → Notification policies**. The intended end state:
  - Contact point `coffeemode-email`, type `email`, address `lvzizhengde@gmail.com`, `singleEmail: false`, `disableResolveMessage: false`. Swap in a Slack webhook later if you prefer — the rules carry `env` / `severity` / `team` labels, so only the receiver changes.
  - Notification policy: root route → receiver `coffeemode-email`, `group_by: ["alertname","env","route"]`, `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 4h`; one child route with matcher `env="staging"` → same receiver, `repeat_interval: 24h` (staging is low priority). The rules deliberately set no per-rule receiver, so this tree is the single place routing is decided.
  - Verify: Alerting → Contact points → `coffeemode-email` → **Test**, then confirm a real notification arrives.

### Application telemetry — OTLP gateway credential (BRAWUKA-606)

- [ ] Paste the OTLP gateway credential into **both** Dokploy app envs. Grafana → Connections → OpenTelemetry → Configure shows the instance ID and an API token; the header value is `Authorization=Basic base64("<instance ID>:<token>")`. Set `OTEL_EXPORTER_OTLP_HEADERS` to that value in the **staging** app env and the **prod** app env (values never go in chat/docs/repo). The endpoint and `OTEL_RESOURCE_ATTRIBUTES` are already pinned in `deploy/dokploy/docker-compose.staging.yml` / `docker-compose.prod.yml` (no sampler — BRAWUKA-605 §6 decision 3, superseded 2026-09-21), so this paste is the only owner step. Until it lands the SDK is registered and every export answers 401; the moment it lands, traces flow with no rebuild.
- [ ] **Enable traces metrics generation** (BRAWUKA-609). It is **off by default** — the metrics-generator is a per-tenant Tempo override, so `traces_spanmetrics_*` never appears however many spans arrive. Grafana → Application Observability → Configuration → System → **Metrics generation**. The other documented path (Knowledge Graph → Observability → Configuration → Traces metrics generation) is unavailable on this stack: it requires the knowledge graph, which is not enabled (`GET /api/datasources/uid/grafanacloud-knowledgegraph/resources` → `503 knowledge graph not enabled`). No cost on Free — the generated series just count against the 10k allowance. **Decisive check, independent of trace flow:** `grafanacloud_traces_instance_metrics_generator_active_series` on the `grafanacloud-usage` datasource must be non-empty and > 0; as of 2026-09-21 it is empty and none of that datasource's 116 metrics match `grafanacloud_traces_instance_metrics_generator_*`.
- [ ] Verify after both: Tempo returns `coffeemode-web` traces and the service map shows edges; `traces_spanmetrics_*` appears in Prometheus with `span_name` as a route template (`GET /api/cafes/[id]`), not a raw path. Note `http_route` is **not** a spanmetrics default label — the default set is `service` / `span_name` / `span_kind` / `status_code`, and the template rides on `span_name`. Adding `http.route` as an extra dimension is optional Grafana-side config, not required for per-route RED. Allow 1–2 minutes after the first spans land: the generator has a 30s slack period and a 60s collection interval.
- [x] Business metrics need no owner action (BRAWUKA-609): `web/lib/observability/metrics.ts` ships `coffeemode.cafe.created` and `coffeemode.auth.login` over the same OTLP gateway and the same credential as traces and logs.

## What the agent continues meanwhile

All non-blocked Phase 1 backlog items have merged to `main` (PRs #19–#22), and the P1 post-review fixes from `fix/post-review-p1-issues` have merged as PR #74. MapKit-specific slices remain blocked on item 4. Cafe creation shipped in PR #128 (merged 2026-08-20) and its item 8 Kimi review completed post-merge on 2026-08-23 (follow-ups #183–#185); Apple live search stays configuration-gated. Backend work such as work-profile aggregation may continue; new user-visible UI stays blocked on its item 8 artifact. The POI and image services are ready to deploy once you complete items 5–7.
