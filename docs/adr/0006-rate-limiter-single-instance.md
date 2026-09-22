# 0006. Rate Limiter Stays In-Memory on the Single App Container

## Status

Accepted

## Context

`web/lib/rate-limit.ts` is an in-memory token-bucket map and the sole
rate-limit backend since BRAWUKA-378 deleted the Postgres token bucket
(outright: every check was a Supabase round trip, no multi-instance deploy
ever consumed it; migration `0026_drop_rate_limits.sql` dropped the table).
Both Dokploy stacks run exactly one web container — neither
`deploy/dokploy/docker-compose.staging.yml` nor `docker-compose.prod.yml`
sets a `replicas`/scale key — so per-process buckets are exact in steady
state. AUDIT-S2 P3 (BRAWUKA-637) requires either a shared store before any
multi-instance deploy or a written acceptance of the single-instance
constraint. This ADR is that written acceptance.

## Decision

Rate limiting stays in-memory on the single app container. No
Redis/Upstash/D1/KV is introduced:

- There is no second consumer: with one container per environment a shared
  store adds a network round trip, a secret, and a cost cliff to every
  request for zero enforcement gain (Spec 0000 Principle 5).
- Postgres was already rejected for this path (BRAWUKA-378); re-adding any
  synchronous remote check repeats the latency it removed.
- KV cannot do an atomic single-use consume, is eventually consistent, and
  caps at 1k writes/day on the free tier (spec 0001 §Tables).
- D1 lives in the Workers plane (`poi-service`), not on the VPS container
  request path — wrong plane for per-request enforcement.
- Prod rolling updates (`deploy/dokploy/docker-compose.prod.yml`
  `deploy.update_config: start-first`) briefly run two containers; each
  enforces its own buckets in that window, so limits are momentarily more
  permissive. Staging has no `update_config` block and recreates in place
  (brief gap, no overlap). Accepted: a deploy window, not steady state.

## Consequences

- Under any future multi-replica deploy, effective limits multiply by the
  replica count — so scaling out is gated on a new shared-store decision.
  That decision, not this ADR, picks the store; the leading candidate is
  Redis/Upstash, evaluated against the per-request latency budget then.
- No code changes: `web/lib/rate-limit.ts`, `web/config/rate-limits.yaml`,
  and the Grafana-managed `CoffeeMode — Rate-limit flood` rule are untouched.
- Specs 0001 (§Rate limiting), 0004 (decision 34b), and 0005 (§Rate Limiter
  Backend) point here as the canonical owner of this constraint.
