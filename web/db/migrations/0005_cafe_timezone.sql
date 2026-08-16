-- CoffeeMode schema v5 (issue #77 — cafe timezone).
-- Apply with: psql "$DATABASE_URL" -f 0005_cafe_timezone.sql
-- Depends on: 0001_init.sql (cafes)

-- opening_hours is a wall-clock weekly template ({mon:{open,close},...}).
-- Without the cafe's own timezone, "open now" is uncomputable for the
-- product's primary story — a nomad checking cafes in another timezone.
-- tz holds the IANA name (e.g. 'Asia/Seoul'), derived from location when a
-- cafe is created (population lands with the cafe-creation slice).
-- Nullable on purpose: rows without tz report open-now as unknown
-- (web/lib/hours.ts returns null), never a wrong answer.
alter table cafes add column if not exists tz text;
