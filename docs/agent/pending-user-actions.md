# Pending User Actions

Things only the repo owner can do — account creation, credential provisioning, and dashboard toggles. The agent cannot (and must not) perform these. Credentials are never pasted into chat, docs, or the repo; put them in `~/.zshrc` or `web/.env.local` and say "配好了" — the agent reads them itself and never echoes them back.

Status legend: `[ ]` needed, `[~]` partially done, `[x]` done.

## 1. Supabase (auth provider) — unlocks auth round-trip

- [~] Project exists; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are in `~/.zshrc`
- [ ] Copy the **anon public key**: Dashboard → Project Settings → API Keys → `anon public` → into `web/.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Redirect URLs allowlist: Dashboard → Authentication → URL Configuration → Redirect URLs → add:
  - `http://localhost:3000/auth/callback` (dev)
  - `https://<production-domain>/auth/callback` (later, at deploy)
- [ ] Enable **Google** provider: Dashboard → Authentication → Providers → Google → paste Google OAuth client id/secret (from item 3 below)
- [ ] Enable **Apple** provider later (needs item 4)

## 2. Postgres (primary database, self-hosted on VPS)

- [ ] Provision Postgres on the VPS (or use managed instance) and enable network access from the Next.js host
- [ ] Enable PostGIS: `CREATE EXTENSION postgis;`
- [ ] Apply the schema: `psql "<connection-string>" -f web/db/migrations/0001_init.sql`
- [ ] Put the connection string into `web/.env.local` as `DATABASE_URL` (shape in `web/.env.example`); add `?sslmode=require` if SSL is required

## 3. Google OAuth (Sign in with Google) — unlocks real login

- [ ] console.cloud.google.com → create/select project → APIs & Services → OAuth consent screen (External, test users OK for now)
- [ ] Credentials → Create OAuth client ID → **Web application** → Authorized redirect URI: `http://localhost:3000/auth/callback` (add production URL later)
- [ ] Put client id/secret into the Supabase dashboard (item 1) — not into the repo

## 4. Apple Sign-In — deferred until Apple Developer Program

- [ ] Buy Apple Developer Program membership ($99/yr) — also needed for MapKit JS (blocks `map-home`)
- [ ] Configure Services ID + Sign in with Apple key, then enable Apple provider in Supabase (item 1)

## 5. Google Places API key — for poi-cache-service deploy

- [ ] console.cloud.google.com → enable **Places API (New)** → create API key → restrict to that API + (later) IP/HTTP referrers
- [ ] The key goes ONLY into the POI Worker (`poi-service/.dev.vars`, never committed). Next.js never sees it.

## 6. image-service deploy

- [ ] Create R2 bucket and S3 API token for image uploads
- [ ] Set `R2_ACCOUNT_ID` in `image-service/wrangler.toml` `[vars]` (public account id; not secret)
- [ ] In a terminal (from `image-service/`):
  - `npm install`
  - Set secrets (values never go in chat/docs): `wrangler secret put IMAGE_SERVICE_TOKEN`, `wrangler secret put R2_ACCESS_KEY_ID`, `wrangler secret put R2_SECRET_ACCESS_KEY`
  - `npm run deploy` → workers.dev URL; wire `IMAGE_SERVICE_URL` + `IMAGE_SERVICE_TOKEN` into `web/.env.local`

## 7. Domain + deploy (later phase)

- [ ] Point domain at the VPS; Cloudflare proxy/CDN in front
- [ ] Cloudflare account for the POI worker (`poi.coffeemode.app` once the domain lands)
- [ ] In a terminal (from `poi-service/`), create the resources and copy the returned ids into `wrangler.toml`:
  - `wrangler d1 create poi-store`
  - `wrangler kv namespace create poi-cache`
- [ ] Apply the schema: `wrangler d1 migrations apply poi-store --remote`
- [ ] Set the two worker secrets (values never go in chat/docs): `wrangler secret put POI_SERVICE_TOKEN`, `wrangler secret put GOOGLE_PLACES_API_KEY`
- [ ] Deploy: `npm run deploy` → workers.dev URL; wire `POI_SERVICE_URL` + `POI_SERVICE_TOKEN` into `web/.env.local`

## What the agent continues meanwhile

Everything not blocked by the above proceeds with mocks: `places-proxy` (PR #12) is implemented and unit-tested (POI Worker mocked) — awaiting your review, then deploy per item 7. `map-home`/`discovery-sheet` stay blocked on item 4's Apple Developer purchase.
