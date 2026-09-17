-- CafeMood schema v26 (BRAWUKA-378 — drop the Postgres rate-limit backend).
-- Single-container deploys enforce rate limits in memory
-- (web/lib/rate-limit.ts); the shared `rate_limits` table is dead weight:
-- every check was a Supabase round trip, and no multi-instance deploy ever
-- consumed it. Fresh databases converge: 0003 creates the table, this drops
-- it; migrated databases just drop it. The table has no dependents.
drop table if exists rate_limits;
