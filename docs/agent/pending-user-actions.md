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

## 2. Postgres (primary database, self-hosted on VPS)

- [ ] Provision Postgres on the VPS (or use managed instance) and enable network access from the Next.js host
- [ ] Enable PostGIS: `CREATE EXTENSION postgis;`
- [ ] Apply the schema: `psql "<connection-string>" -f web/db/migrations/0001_init.sql`
- [ ] Put the connection string into `web/.env.local` as `DATABASE_URL` (shape in `web/.env.example`); add `?sslmode=require` if SSL is required (use `sslmode=allow-self-signed` for self-signed certs)

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
  - Add an R2 lifecycle rule to clean up abandoned `original/` objects. If completed originals share the same prefix, separate pending uploads to a `pending/` prefix first and expire it after 24 h, or expire `original/` only after a safe age that won’t delete live images.

## 7. Domain + deploy (later phase)

- [ ] Point domain at the VPS; Cloudflare proxy/CDN in front
- [ ] Cloudflare account for the POI worker (`poi.coffeemode.app` once the domain lands)
- [ ] In a terminal (from `poi-service/`), create the resources and copy the returned ids into `poi-service/wrangler.toml`:
  - `wrangler d1 create poi-store` → paste `database_id` into `POI_DB`
  - `wrangler kv namespace create poi-cache` → paste `id` into `POI_KV`
- [ ] Apply the schema: `wrangler d1 migrations apply poi-store --remote`
- [ ] Set the two worker secrets (values never go in chat/docs): `wrangler secret put POI_SERVICE_TOKEN`, `wrangler secret put GOOGLE_PLACES_API_KEY`
- [ ] Deploy: `npm run deploy` → workers.dev URL; wire `POI_SERVICE_URL` + `POI_SERVICE_TOKEN` into `web/.env.local`

## 8. Kimi K3 UI design artifacts

- [ ] Review PR #128's creation flow with Kimi K3 before merge.
- [ ] Provide a Kimi K3 discovery artifact for issue #133 covering mobile
  PEEK/HALF/FULL, desktop sidebar/detail drawer, compact place-characteristic
  icons, both-score hierarchy, Navigate / Check in / Share placement, the
  Helpful/Newest control, and the accepted drag/scroll behavior.
- [ ] Provide a slice-specific Kimi K3 artifact before starting any other new
  user-visible UI implementation.

## 9. Discovery feed ranking

- [ ] Choose the deterministic Helpful ranking formula and cursor tie-breakers
  for issue #133. Helpful/Newest modes and 20-item opaque cursors are already
  fixed; this remaining product decision is question DG16.

## What the agent continues meanwhile

All non-blocked Phase 1 backlog items have merged to `main` (PRs #19–#22), and the P1 post-review fixes from `fix/post-review-p1-issues` have merged as PR #74. MapKit-specific slices remain blocked on item 4. Cafe creation's Google/Apple link import and Google search work while Apple live search is configuration-gated, but PR #128 still needs item 8's Kimi review. Backend work such as work-profile aggregation may continue; new user-visible UI stays blocked on its item 8 artifact, and discovery additionally waits for item 9. The POI and image services are ready to deploy once you complete items 5–7.
