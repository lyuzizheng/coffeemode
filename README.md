# coffeemode

CoffeeMode MonoRepo

## Components

- /web                    Next.js 16 full-stack app (active)
- /poi-service            Cloudflare Worker POI cache service
- /image-service          Cloudflare Worker image upload service
- /_archive-coffeemode-frontend  legacy Vite app (archived)
- /_archive-coffeemode-backend   legacy Java backend (archived)
- /coffeemode_script

## Tech Stack

- Next.js 16 (App Router) + React + TypeScript
- TailwindCSS v4 + HeroUI v3
- Self-hosted Postgres + Supabase Auth
- Cloudflare Workers (Wrangler) for the POI cache and image services

Coding conventions: `docs/agent/coding-conventions.md`. Spring Boot powered the
now-archived Java backend under `_archive-coffeemode-backend/`.
