# Pending User Actions

Things only the repo owner can provide or approve — account creation, credential
provisioning, dashboard toggles, and approval of agent-drafted design artifacts
(spec 0004 decision 6b). The agent cannot perform these. Credentials are never
pasted into chat, docs, or the repo; put them in `~/.zshrc` or `web/.env.local`
and say "配好了" — the agent reads them itself and never echoes them back.

Status legend: `[ ]` needed, `[~]` partially done, `[x]` done.

## 1. Supabase (auth provider) — unlocks auth round-trip

- [~] Project exists; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are in `~/.zshrc`
- [ ] Set public site / allowlist env vars from `web/.env.example`:
  - `NEXT_PUBLIC_SITE_URL` (required, e.g. `http://localhost:3000`, no trailing slash)
  - `NEXT_PUBLIC_ALLOWED_HOSTS` (optional, comma-separated, e.g. `localhost:3001`)
- [ ] Copy the **anon public key**: Dashboard → Project Settings → API Keys → `anon public` → into `web/.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Redirect URLs allowlist: Dashboard → Authentication → URL Configuration → Redirect URLs → add `${NEXT_PUBLIC_SITE_URL}/auth/callback` and the `/auth/callback` URL for every host in `NEXT_PUBLIC_ALLOWED_HOSTS`. At minimum:
  - `${NEXT_PUBLIC_SITE_URL}/auth/callback` (e.g. `http://localhost:3000/auth/callback` or `https://<production-domain>/auth/callback`)
  - `http://localhost:3001/auth/callback` (if you add `localhost:3001` to `NEXT_PUBLIC_ALLOWED_HOSTS`)
  - any staging/preview domains you add to `NEXT_PUBLIC_ALLOWED_HOSTS`
- [ ] Enable **Google** provider: Dashboard → Authentication → Providers → Google → paste Google OAuth client id/secret (from item 3 below)
- [ ] Enable **Apple** provider later (needs item 4)

## 1a. Staging journey secrets (GitHub Environment `staging`) — unlocks post-merge staging verification

- [x] Ephemeral runner-local Postgres (`postgis/postgis:16-3.4`) started via `docker compose -f ../docker-compose.yml up -d --wait postgres`, with `STAGING_DATABASE_URL` hardcoded to `postgresql://coffeemode:coffeemode@localhost:5432/coffeemode` in `.github/workflows/staging-journey.yml` (BRAWUKA-525). Dokploy CI Postgres (`coffeemode-ci-postgres`) and Cloudflare Tunnel (`ci-db.cafemood.app`) path superseded and scheduled for decommission.
- [x] GitHub Environment `staging` secrets cleanup: remove `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, and `STAGING_DATABASE_URL` (no longer needed by staging-journey). Retain `SUPABASE_URL` (= `https://ojujmjewtbquiddswyrg.supabase.co`) and `SUPABASE_ANON_KEY` for auth smoke checks.
- [ ] (Optional, for real-session journey suites) Staging Supabase project dashboard → Settings → API: copy `service_role` key into GitHub Environment `staging` as `SUPABASE_SERVICE_ROLE_KEY`. (Staging CI verification currently passes using `SUPABASE_ANON_KEY` for auth smoke verification.)
- [ ] Redirect URLs allowlist on the **staging** project (spec 0010 §1): `http://localhost:3000/auth/callback` (local dev against staging auth) + `https://staging.cafemood.app/auth/callback`.
- [ ] Confirm Google provider is enabled on the **staging** project (item 3's client works for both; the Supabase callback `https://ojujmjewtbquiddswyrg.supabase.co/auth/v1/callback` must be in the Google client's authorized redirect URIs).
- [ ] `production` environment: owner (`lyuzizheng`) is the required reviewer (already set); prod secrets land there only at promotion time, never before.

## 2. Postgres (primary database — Supabase, per 0004 decision 34a, owner 2026-08-28)

- [x] Create the Supabase project (free tier) in the region closest to the VPS (CafeMood project `rsdzcegylqgccaneomph` active in `ap-southeast-1`)
- [x] Enable PostGIS in the SQL editor: `CREATE EXTENSION postgis;` (automated & verified via `scripts/devops/provision-supabase.sh`)
- [x] Apply the schema with the session/direct connection (not the transaction pooler): `DATABASE_URL=<session-conn> npm run db:migrate` (all 19 migrations 0001–0019 applied; automated via `scripts/devops/provision-supabase.sh`)
- [x] ~~Put the pooled connection string into the VPS env as `DATABASE_URL`~~ Superseded 2026-09-20 (BRAWUKA-507): staging app data moved off Supabase to Dokploy VPS Postgres `coffeemode-staging-db`; `DATABASE_URL` now points at the `dokploy-network` internal `:5432` (`sslmode=disable`). Prod still needs the Supabase pooled string when it deploys (BRAWUKA-500).
- [x] 已迁 VPS cron: nightly recompute 与 Helpful ranking 快照已迁至 Dokploy 定时任务（02:00 UTC，BRAWUKA-475），DATABASE_URL 仅在 VPS env 保留，无需进 GitHub secrets
- [x] 定时任务失败告警自愈接线（BRAWUKA-476）：Dokploy env 配置 `MULTICA_AUTOPILOT_WEBHOOK_URL`，并在 Dokploy Notifications 挂载 Custom Webhook（兜底平台与构建异常）；非零退出时 POST 触发 CoffeeMode 运维告警自愈 autopilot 自动建单
- [x] Verify product tables are NOT reachable via the Supabase Data API (PostgREST) with the browser anon key — all application tables have RLS enabled and grants revoked from `anon` & `authenticated` (verified via `scripts/devops/provision-supabase.sh`)
- [ ] Free-tier cliffs: 500MB DB then read-only (seed negligible today — 14 cafes; re-measure before any bulk import), 5GB egress (images stay on R2), no backups — schedule `pg_dump` to R2 as the cheap mitigation

## 3. Google OAuth (Sign in with Google) — unlocks real login

- [ ] console.cloud.google.com → create/select project → APIs & Services → OAuth consent screen (External, test users OK for now)
- [ ] Credentials → Create OAuth client ID → **Web application** → Authorized redirect URI: paste the Supabase Auth callback URL shown in Dashboard → Authentication → Providers → Google (e.g. `https://<project-ref>.supabase.co/auth/v1/callback`)
- [ ] Put client id/secret into the Supabase dashboard (item 1) — not into the repo

## 4. Apple Sign-In — deferred until Apple Developer Program

- [ ] Buy Apple Developer Program membership ($99/yr) — also needed for MapKit JS (blocks Apple-only slices, not cafe creation's link/Google paths; #131)
- [ ] Configure Services ID + Sign in with Apple key, then enable Apple provider in Supabase (item 1)

## 5. Google Places API key — for poi-cache-service deploy

- [ ] console.cloud.google.com → enable **Places API (New)** → create API key → restrict to that API + (later) IP/HTTP referrers
- [ ] The key goes ONLY into the POI Worker (`poi-service/.dev.vars`, never committed). Next.js never sees it.

## 5a. Cloudflare Turnstile widget + keys — for anonymous `POST /api/places/resolve` (BRAWUKA-239)

- [ ] Cloudflare dashboard → Turnstile → Add widget → type Managed (invisible mode is set client-side per surface), domains: `cafemood.app`, `staging.cafemood.app`, `localhost`, `127.0.0.1` (free, unlimited validations; if staging sits behind Cloudflare Access, add the Access login host too or the challenge cannot load there)
- [ ] Put the secret into the app env as `TURNSTILE_SECRET_KEY` (server-only; VPS env / secrets manager — never `NEXT_PUBLIC_*`, never chat/docs/repo) and the sitekey as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (rebuild after setting — Next inlines it into the client bundle). Dev/test without keys skip verification; production without `TURNSTILE_SECRET_KEY` fails closed (403 `bot_verification_failed`)
- [ ] Verify: anonymous `POST /api/places/resolve` without/forged token → 403; real browser link-import flow → 200

**Only remaining owner item for the POI service** (2026-09-12, BRAWUKA-222): the four
Cloudflare resources, both migrations, both deployments and both `POI_SERVICE_TOKEN`
secrets are done. Until this key is installed on both Workers
(`wrangler secret put GOOGLE_PLACES_API_KEY --env staging|production`, or the equivalent
Cloudflare API call), `/poi/:place_id`, the query path of `/poi/resolve`, and
`/poi/search/external` answer 502 `upstream_error`; `POST /poi/external` → `GET /poi/search`
and the KV hot-cache read path are unaffected and verified working.

## 6. image-service deploy

- [x] Create R2 bucket and S3 API token for image uploads (`coffeemode-images-prod` and `coffeemode-images-staging` provisioned in APAC with CORS configured)
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
  List/Head/Delete on `original/` only. Each run is two steps:
  1. `DATABASE_URL=... node web/scripts/export-live-image-keys.mjs > /tmp/live-keys.txt`
     (read-only; exports every `original/` key still referenced by live
     `cafes.gallery` / `checkins.photos`).
  2. First run with `LIVE_KEYS_FILE=/tmp/live-keys.txt DRY_RUN=1
  RETENTION_DAYS=7`, review the JSON output, then set `DRY_RUN=0`. The script
  deletes marker-less originals and provision-stage uploads that were never
  attached AND are absent from the live-keys export; post-commit attach
  (BRAWUKA-400) re-marks live originals to `checkin`, and any stale-marker
  key that IS referenced is reported as `would-keep … reason:"referenced"`
  and never deleted.

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
  - `GOOGLE_PLACES_API_KEY` NOT installed — still blocked on item 5. Until it is, `/poi/:place_id`, `/poi/resolve` (query path) and `/poi/search/external` return 502 `upstream_error`; every other path works.
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
- [x] Better Stack account + per-environment sources for rate-limit/observability alerts (DG129, BRAWUKA-235): sources `coffeemode-rate-limit-staging` and `coffeemode-rate-limit-prod` (HTTP platform, team `Your team`, created 2026-09-17 via MCP). Live wiring verified same day: one synthetic `rate_limited` event per source, each confirmed back through the Better Stack query API within ~1 min. What remains is owner-side paste (values never go in chat/docs/repo): in the **Dokploy staging app env** set `BETTER_STACK_INGEST_URL` to the staging source host and `BETTER_STACK_INGEST_TOKEN` to the staging source token, same for **prod** with the prod source's own pair (Better Stack dashboard → Logs → each source → ingestion details). App code sends `Authorization: Bearer BETTER_STACK_INGEST_TOKEN` (see `web/lib/observability/rate-limit-alert.ts`); both vars are server-only (spec 0010 — never `NEXT_PUBLIC_*`). Never reuse one env's pair in the other — per-env filtering depends on it. Optional follow-up (not blocking): per-source alert rules (`rate_limited` → low-severity, `rate_limiter_fail_open` → immediate P1).
- [~] Better Stack `coffeemode-api-errors` source pair for the API error/warn JSON lines (spec 0011 D8, BRAWUKA-541): sources `coffeemode-api-errors-staging` and `coffeemode-api-errors-prod` (HTTP platform, team `Your team`, created 2026-09-21 via MCP), the `CoffeeMode API Errors (staging)` / `(prod)` dashboards (5xx by `route`, error-`code` histogram, 429 by `bucket`, worker `upstream_error`), and two chart alerts each (5xx sustained on a route; worker `upstream_error` spike). Ingest verified 2026-09-21: synthetic `internal_error` lines round-tripped through the query API on both sources. **Owner action**: in the **Dokploy staging app env** set `BETTER_STACK_ERRORS_INGEST_URL` to the staging errors source host and `BETTER_STACK_ERRORS_INGEST_TOKEN` to its token, same for **prod** with the prod source's own pair (Better Stack dashboard → Logs → each source → ingestion details). App code sends `Authorization: Bearer BETTER_STACK_ERRORS_INGEST_TOKEN` (see `web/lib/observability/api-error-sink.ts`); both vars are server-only (spec 0010 — never `NEXT_PUBLIC_*`). Never reuse one env's pair in the other. Until pasted, error lines stay stdout-only and the dashboard/alerts see no app traffic.

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
- [ ] Create the Grafana Cloud stack (grafana.com — the free tier is enough) and grant the connecting user the `Assistant Cloud MCP User` role (Editor or higher has it by default).
- [ ] Authorize the MCP client: omp opens a browser on first connect; Hermes needs `hermes mcp login grafana`. Both ask for the stack URL (`https://<stack>.grafana.net`) and read vs read+write scope. Restart the agent session afterwards so the tools load.
- [ ] (Optional) Decide whether the rate-limit alert sink (`web/lib/observability/rate-limit-alert.ts`, DG129) moves from Better Stack to Grafana Cloud. Nothing changes until that call is made; the Better Stack sources stay live meanwhile.

## What the agent continues meanwhile

All non-blocked Phase 1 backlog items have merged to `main` (PRs #19–#22), and the P1 post-review fixes from `fix/post-review-p1-issues` have merged as PR #74. MapKit-specific slices remain blocked on item 4. Cafe creation shipped in PR #128 (merged 2026-08-20) and its item 8 Kimi review completed post-merge on 2026-08-23 (follow-ups #183–#185); Apple live search stays configuration-gated. Backend work such as work-profile aggregation may continue; new user-visible UI stays blocked on its item 8 artifact. The POI and image services are ready to deploy once you complete items 5–7.
