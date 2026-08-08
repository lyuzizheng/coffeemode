# 0001. Next.js Full-Stack Rewrite on VPS

## Status

Accepted

## Context

CoffeeMode began as a Vite React SPA (`_archive-coffeemode-frontend/`) plus a Java Spring Boot backend (`_archive-coffeemode-backend/`) with MongoDB. The design grill (rounds 1–6, see `docs/alignment-temp/alignment-progress.md`) re-scoped the product as a digital-nomad coworking review platform and revisited the stack end to end.

Key constraints:

- The Java backend added deployment and hiring friction with no capability the new design needs.
- The frontend must be rewritten anyway (new design system, bottom-sheet SPA, Apple Maps).
- Auth is Apple/Google OAuth only (Supabase Auth). The primary data store was originally Neon Postgres; this was later revised by ADR-0002 to self-hosted Postgres on the VPS.
- Images go to Cloudflare R2; the map is Apple MapKit JS; external POI search stays on Google Places.
- The owner runs a VPS with a public IP and wants Cloudflare as the CDN/auxiliary layer.

## Decision

Rewrite the product as a single Next.js 15+ (currently 16.x) full-stack application in `web/`:

- Deploy the app to the VPS with Docker and Next.js `output: 'standalone'`, fronted by Cloudflare CDN/proxy. `@opennextjs/cloudflare` remains a documented future option, not the MVP target.
- Remove the Java backend entirely; no data migration from MongoDB is planned for MVP.
- Keep an independent Cloudflare Workers + D1 + KV service as the only holder of the Google Places API key, so POI lookups are cacheable and reusable by other services.

## Consequences

- One deployable unit for the app instead of two; server code lives in Next.js route handlers and server actions.
- Sharp runs on the VPS for image processing (Workers CPU limits are too tight for that).
- The legacy `coffeemode-frontend/` and `coffeemode_backend/` directories have been archived as `_archive-coffeemode-frontend/` and `_archive-coffeemode-backend/` and remain only as historical reference.
- Product and implementation details live in `docs/specs/0001-nextjs-migration.md`; this ADR records only the architectural direction.
