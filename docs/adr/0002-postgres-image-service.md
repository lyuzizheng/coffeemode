# 0002. Self-hosted Postgres + image-service Worker

## Status

Accepted

Item 1 revised 2026-08-28: the main Postgres runs on Supabase, free tier first, per
the owner decision recorded as spec 0004 decision 34a; the VPS runs Next.js only.
Items 2–4 — image-service Worker, sharp processing on the app host, poi-service —
are unchanged and remain Accepted.

## Context

The original CoffeeMode rewrite pinned the data layer to Neon Postgres and planned the image upload pipeline as a Next.js route handler using `sharp` and R2. That was a reasonable default, but it created two coupling problems:

1. **Vendor/data portability**: Neon is a managed service with its own serverless driver. If the project moves to a self-hosted VPS, the driver and connection model need to change.
2. **Image upload cost/security**: Processing images inside a Next.js request keeps R2 credentials and resize logic in the main app. More importantly, the original plan had the browser upload the image to the Next.js server, which means bandwidth and CPU on the VPS before anything reaches R2.

We also want Cloudflare to do the fixed, edge-suitable parts of the system (POI cache, upload URL signing) while keeping heavy or stateful work on the VPS.

## Decision

1. **Data layer**: replace Neon with a self-hosted Postgres running on the same VPS as Next.js. `web/lib/db` moves from `@neondatabase/serverless` to the standard `pg` Pool. Supabase remains AUTH ONLY. **(Revised 2026-08-28 — see Status: the main Postgres moves to Supabase per 0004 decision 34a; the `@neondatabase/serverless` → `pg` Pool change stands, and Supabase's Data API must not expose product tables, 0001 §Data layer.)**
2. **Image upload**: introduce a dedicated `image-service` Cloudflare Worker microservice that signs presigned R2 URLs. Endpoint, request/response shape, key naming, and metadata conventions are specified in `docs/specs/0001-nextjs-migration.md`.
3. **Image processing**: Next.js `/api/images/complete` runs `sharp` on the VPS to produce the display variants, writes them back to R2, and updates `cafes.gallery` / `checkins.photos` JSONB in Postgres. Size/quality rules, auth model, and DB record shape are specified in `docs/specs/0001-nextjs-migration.md`.
4. **POI service**: remains unchanged as a Cloudflare Worker microservice (`poi-service/`).

## Consequences

- The VPS runs Next.js only; the main Postgres is Supabase (revised 2026-08-28, 0004 decision 34a). Backups: Supabase free tier has none — schedule `pg_dump` to R2 until the Pro upgrade (triggers in 0004 Post-MVP).
- `DATABASE_URL` supports `sslmode=require/prefer/verify-ca/verify-full/allow-self-signed/disable`. All modes except `allow-self-signed` and `disable` validate the CA chain (`rejectUnauthorized: true`); `allow-self-signed` is the explicit opt-in for self-managed VPS certs without a public CA chain, and unrecognized values fail closed (revised by issue #41 — `require`/`prefer` originally defaulted to `rejectUnauthorized: false`, which silently accepted any certificate).
- `sharp` and `libvips` must be present in the Docker image.
- Cloudflare usage stays within free-tier limits: Worker invocations are low (one per upload request, one per process request), R2 handles storage and egress, and no Cloudflare Images transforms are used.
- R2 S3 credentials live only in the `image-service` Worker (for signing). Next.js receives presigned GET/PUT URLs from the Worker and never stores or exposes R2 credentials.
- The `image-service` Worker is stateless and can be tested independently from the Next.js app.
