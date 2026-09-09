-- CoffeeMode schema v19 (BRAWUKA-119 / DG61 — check-in idempotency key).
-- The drawer generates one UUID per open and sends it with the create; the
-- server dedupes on (user_id, idempotency_key) so a retry after a flaky
-- connection can never double-record. Nullable so pre-key rows and the fused
-- cafe-creation first check-in (which has no drawer key) stay valid; the
-- partial predicate keeps those NULL rows out of the uniqueness scope.
alter table checkins
  add column if not exists idempotency_key uuid;

create unique index if not exists idx_checkins_user_idempotency
  on checkins (user_id, idempotency_key)
  where idempotency_key is not null;
