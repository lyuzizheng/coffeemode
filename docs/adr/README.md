# Architecture Decision Records

ADRs record architecture decisions with historical context. They do not replace specs: `docs/specs/` owns intended behavior, ADRs own why a direction was chosen.

Every ADR must have a `## Status` heading with one of: `Proposed`, `Accepted`, `Superseded`, `Deprecated`, `Rejected`.

> 2026-09-14 — Product renamed from CoffeeMode to CafeMood (primary domain
> cafemood.app). ADR bodies keep their pre-rename wording as timestamped
> history; new decisions use CafeMood.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001-nextjs-fullstack-rewrite.md](./0001-nextjs-fullstack-rewrite.md) | Next.js full-stack rewrite on VPS | Accepted |
| [0002-postgres-image-service.md](./0002-postgres-image-service.md) | Self-hosted Postgres + image-service Worker | Accepted |
| [0003-pwa-service-worker.md](./0003-pwa-service-worker.md) | PWA service worker architecture | Accepted |
| [0004-server-log-request-id.md](./0004-server-log-request-id.md) | Server structured errors + request-id | Accepted |
| [0005-metrics-search-observability.md](./0005-metrics-search-observability.md) | Search observability — metrics, collection, promotion thresholds | Accepted |
| [0006-rate-limiter-single-instance.md](./0006-rate-limiter-single-instance.md) | Rate limiter stays in-memory on the single app container | Accepted |
| [0007-sitemap-full-scan-accepted.md](./0007-sitemap-full-scan-accepted.md) | Sitemap query — full scan accepted until sharding threshold | Accepted |
| [0008-checkin-feed-unvirtualized-accepted.md](./0008-checkin-feed-unvirtualized-accepted.md) | Check-in feed — unvirtualized rendering accepted until deep-scroll threshold | Accepted |
| [0009-edge-forwarded-proto-trust.md](./0009-edge-forwarded-proto-trust.md) | Edge header trust — `x-forwarded-proto` | Accepted |
