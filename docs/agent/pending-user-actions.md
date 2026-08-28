# Pending User Actions

Things only the repo owner can provide or approve — account creation, credential
provisioning, dashboard toggles, and required external design artifacts. The
agent cannot perform these. Credentials are never pasted into chat, docs, or the
repo; put them in `~/.zshrc` or `web/.env.local` and say "配好了" — the agent reads
them itself and never echoes them back.

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

## 2. Postgres (primary database — Supabase, per 0004 decision 34a, owner 2026-08-28)

- [ ] Create the Supabase project (free tier) in the region closest to the VPS — route handlers run multi-round-trip transactions, so RTT multiplies
- [ ] Enable PostGIS in the SQL editor: `CREATE EXTENSION postgis;`
- [ ] Apply the schema with the session/direct connection (not the transaction pooler): `DATABASE_URL=<session-conn> npm run db:migrate` (applies web/db/migrations/0001 onward)
- [ ] Put the pooled connection string into the VPS env as `DATABASE_URL` with `?sslmode=require` (fail-closed per #41); keep the session connection string for migrations/CI
- [ ] Set `RATE_LIMIT_BACKEND=memory` on the app container (decision 34a — single container; Postgres backend retained for a future multi-instance deploy)
- [ ] Add `DATABASE_URL` as a GitHub Actions secret so the nightly recompute doubles as the free-tier keep-alive (defeats the 7-day inactivity pause)
- [ ] Verify product tables are NOT reachable via the Supabase Data API (PostgREST) with the browser anon key — new projects no longer auto-expose new tables, but verify and, if needed, `revoke all on <table> from anon, authenticated;` for all 7 app tables, 5 product + 2 infra (invariant in spec 0001 §Data layer)
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

## 6. image-service deploy

- [ ] Create R2 bucket and S3 API token for image uploads
- [ ] Set the placeholders in `image-service/wrangler.toml` `[vars]`:
  - `R2_ACCOUNT_ID` (public Cloudflare account id)
  - `R2_BUCKET_NAME` (must match the `[[r2_buckets]]` `bucket_name`)
  - `R2_PUBLIC_URL` (your public R2 / CDN base URL, no trailing slash)
- [ ] In a terminal (from `image-service/`):
  - `npm install`
  - Set secrets (values never go in chat/docs): `wrangler secret put IMAGE_SERVICE_TOKEN`, `wrangler secret put R2_ACCESS_KEY_ID`, `wrangler secret put R2_SECRET_ACCESS_KEY`
  - `npm run deploy` → workers.dev URL; wire `IMAGE_SERVICE_URL` + `IMAGE_SERVICE_TOKEN` into `web/.env.local`
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

- [ ] Point domain at the VPS; Cloudflare proxy/CDN in front
- [ ] Cloudflare account for the POI worker (`poi.coffeemode.app` once the domain lands)
- [ ] In a terminal (from `poi-service/`), create the resources and copy the returned ids into `poi-service/wrangler.toml`:
  - `wrangler d1 create poi-store` → paste `database_id` into `POI_DB`
  - `wrangler kv namespace create poi-cache` → paste `id` into `POI_KV`
- [ ] Apply the schema: `wrangler d1 migrations apply poi-store --remote`
- [ ] Set the two worker secrets (values never go in chat/docs): `wrangler secret put POI_SERVICE_TOKEN`, `wrangler secret put GOOGLE_PLACES_API_KEY`
- [ ] Deploy: `npm run deploy` → workers.dev URL; wire `POI_SERVICE_URL` + `POI_SERVICE_TOKEN` into `web/.env.local`
- [ ] Enable the Cloudflare "Add visitor location headers" Managed Transform on the zone (sends `CF-IPCity` / `CF-IPCountry`; default-city resolution per DG128)
- [ ] Create a Better Stack account + alert token for rate-limit/observability alerts (DG129); put the token in `web/.env.local` once the integration lands

## 8. Kimi K3 UI design artifacts

- [x] Review PR #128's creation flow with Kimi K3 before merge. (Completed post-merge on 2026-08-23 — verdict on PR #128; follow-ups #183–#185.)
- [ ] Provide a Kimi K3 discovery artifact for issue #133 covering mobile
  PEEK/HALF/FULL, desktop sidebar/detail column, compact place-characteristic
  icons, both-score hierarchy, Navigate / Check in / Share placement, the
  Helpful/Newest control, tablet landscape, failure/Retry and missing-cafe toast
  states, non-modal focus, and the accepted drag/scroll behavior.
- [ ] Provide a slice-specific Kimi K3 artifact before starting any other new
  user-visible UI implementation.

## What the agent continues meanwhile

All non-blocked Phase 1 backlog items have merged to `main` (PRs #19–#22), and the P1 post-review fixes from `fix/post-review-p1-issues` have merged as PR #74. MapKit-specific slices remain blocked on item 4. Cafe creation shipped in PR #128 (merged 2026-08-20) and its item 8 Kimi review completed post-merge on 2026-08-23 (follow-ups #183–#185); Apple live search stays configuration-gated. Backend work such as work-profile aggregation may continue; new user-visible UI stays blocked on its item 8 artifact. The POI and image services are ready to deploy once you complete items 5–7.
