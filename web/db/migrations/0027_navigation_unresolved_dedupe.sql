-- CoffeeMode schema v27 (BRAWUKA-391: deduplicate unresolved navigations).
-- When a user taps "导航" multiple times for the same cafe, deduplicate pending
-- prompt rows so only one unresolved navigation exists per (user_id, cafe_id).
-- 1. Resolve older unresolved duplicates with 'auto' for existing data compatibility.
with ranked as (
  select id, row_number() over (partition by user_id, cafe_id order by created_at desc) as rn
  from navigations
  where resolved = false
)
update navigations n
set resolved = true, outcome = 'auto'
from ranked r
where n.id = r.id and r.rn > 1;

-- 2. Partial unique index to guarantee uniqueness of unresolved navigations
create unique index if not exists idx_navigations_user_cafe_unresolved
  on navigations (user_id, cafe_id)
  where resolved = false;
