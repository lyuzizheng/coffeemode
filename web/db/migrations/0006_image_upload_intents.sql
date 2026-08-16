-- CoffeeMode schema v6 (Phase 1, issue #33).
-- Apply with: psql "$DATABASE_URL" -f 0006_image_upload_intents.sql
-- Depends on: 0001_init.sql

-- Upload intents bind a presigned imageUuid to the user it was issued to.
-- Without this, anyone holding a leaked upload URL could `complete` the
-- image against a target THEY own, breaking image provenance.
--
-- Lifecycle: inserted by POST /api/images/upload, single-used (DELETE) by
-- /api/images/complete inside its atomic transaction. Freshness is checked
-- against a 1h window — a generous margin over the 10min presigned-URL TTL
-- (image-service DEFAULT_UPLOAD_URL_TTL_SECONDS). Orphaned rows (upload
-- abandoned before complete) are tiny; a cleanup pass is a follow-up for
-- the future nightly job, no cron at MVP.
create table if not exists image_upload_intents (
  image_uuid  uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists idx_upload_intents_created on image_upload_intents (created_at);
