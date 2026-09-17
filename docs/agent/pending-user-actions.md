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

- [ ] In the **staging** Supabase project (`ojujmjewtbquiddswyrg`) dashboard → Settings → API: copy the `anon public` key and a **session/direct** (`:5432`, never the `:6543` pooler — `CREATE DATABASE` cannot run through it, spec 0010 §4) Postgres connection string.
- [ ] `gh secret set` into the `staging` environment (never into the repo, never `NEXT_PUBLIC_*`):
  `STAGING_DATABASE_URL`, `SUPABASE_URL` (= `https://ojujmjewtbquiddswyrg.supabase.co`), `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Redirect URLs allowlist on the **staging** project (spec 0010 §1): `http://localhost:3000/auth/callback` (local dev against staging auth) + `https://staging.cafemood.app/auth/callback`.
- [ ] Confirm Google provider is enabled on the **staging** project (item 3's client works for both; the Supabase callback `https://ojujmjewtbquiddswyrg.supabase.co/auth/v1/callback` must be in the Google client's authorized redirect URIs).
- [ ] `production` environment: owner (`lyuzizheng`) is the required reviewer (already set); prod secrets land there only at promotion time, never before.

## 2. Postgres (primary database — Supabase, per 0004 decision 34a, owner 2026-08-28)

- [x] Create the Supabase project (free tier) in the region closest to the VPS (CafeMood project `rsdzcegylqgccaneomph` active in `ap-southeast-1`)
- [x] Enable PostGIS in the SQL editor: `CREATE EXTENSION postgis;` (automated & verified via `scripts/devops/provision-supabase.sh`)
- [x] Apply the schema with the session/direct connection (not the transaction pooler): `DATABASE_URL=<session-conn> npm run db:migrate` (all 19 migrations 0001–0019 applied; automated via `scripts/devops/provision-supabase.sh`)
- [ ] Put the pooled connection string into the VPS env as `DATABASE_URL` with `?sslmode=require` (fail-closed per #41); keep the session connection string for migrations/CI
- [ ] Set `RATE_LIMIT_BACKEND=memory` on the app container (decision 34a — single container; Postgres backend retained for a future multi-instance deploy)
- [ ] Add `DATABASE_URL` as a GitHub Actions secret so the nightly recompute doubles as the free-tier keep-alive (defeats the 7-day inactivity pause)
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
  - Orphan cleanup (issue #158): do NOT add a blanket R2 lifecycle expiry on
    `original/` — completed gallery originals share that prefix. Instead schedule
    `image-service/scripts/clean-orphan-originals.mjs` (e.g. daily cron or GitHub
    scheduled workflow via #154) with least-privilege R2 credentials that allow
    List/Head/Delete on `original/` only: first run with `DRY_RUN=1
    RETENTION_DAYS=7`, review the JSON output, then set `DRY_RUN=0`. The script
    deletes marker-less originals and provision-stage uploads that were never
    attached; live gallery originals carry `x-amz-meta-targettype` of
    cafe|checkin and are never matched.

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
- [ ] Worker route migration (BRAWUKA-236) — the `cafemood.app` zone is live
  (NS delegated, verified 2026-09-15) but serves zero records for the worker
  hostnames; the custom-domain `routes` are declared in
  `poi-service/wrangler.toml` / `image-service/wrangler.toml` and attach on
  the next deploy:
  1. Redeploy: `npm run deploy -- --env staging` and `--env production` in
     `poi-service/` and `image-service/` (needs the `CLOUDFLARE_API_TOKEN`
     from the item below — the wrangler OAuth session is expired).
  2. Verify each custom domain answers: `curl
     https://poi-service.cafemood.app/health`,
     `https://image-service.cafemood.app/health` (+ staging pair).
  3. Switch the Dokploy env vars `POI_SERVICE_URL` / `IMAGE_SERVICE_URL`
     (values in `deploy/dokploy/.env.*.example`) to the custom domains,
     rolling-restart the web app, verify `/api/places/search` and
     `/api/images/upload` end-to-end.
  4. Only after step 3 is green: add `workers_dev = false` to each `[env.*]`
     block (or disable the workers.dev route in Settings → Domains &
     Routes) and redeploy — never before, or the web app loses its upstream.
  5. Shared-secret headers (`x-poi-service-token` /
     `x-image-service-token`) stay unchanged — the zone route is
     defense-in-depth, not a token replacement.
- [ ] Enable the Cloudflare "Add visitor location headers" Managed Transform on the zone (sends `CF-IPCity` / `CF-IPCountry`; default-city resolution per DG128)
- [ ] Create a Better Stack account + alert token for rate-limit/observability alerts (DG129); put the ingest URL in `web/.env.local` / Dokploy env as `BETTER_STACK_INGEST_URL` — the app-side integration is implemented and verified end-to-end against a local sink (BRAWUKA-235); only the account + token remain

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

## What the agent continues meanwhile

All non-blocked Phase 1 backlog items have merged to `main` (PRs #19–#22), and the P1 post-review fixes from `fix/post-review-p1-issues` have merged as PR #74. MapKit-specific slices remain blocked on item 4. Cafe creation shipped in PR #128 (merged 2026-08-20) and its item 8 Kimi review completed post-merge on 2026-08-23 (follow-ups #183–#185); Apple live search stays configuration-gated. Backend work such as work-profile aggregation may continue; new user-visible UI stays blocked on its item 8 artifact. The POI and image services are ready to deploy once you complete items 5–7.
