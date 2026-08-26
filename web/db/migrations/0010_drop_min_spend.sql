-- CoffeeMode schema v10 (issue #214 / DG125 — remove min_spend).
-- The min_spend policy dimension is removed from the product entirely.
-- Never edit applied migrations; drop the column here so existing
-- deployments can migrate forward. work_stats JSONB is cleaned lazily
-- on the next recompute (coerceWorkStats ignores legacy keys).

alter table checkins drop column if exists min_spend;
