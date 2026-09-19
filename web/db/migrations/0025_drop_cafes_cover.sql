-- CafeMood schema v25 (BRAWUKA-307 — drop write-frozen cafes.cover).
-- The last writer (attachImageToCafe, `cover = case when $5::boolean then $2 else cover end`)
-- was deleted in PR #467, so no code path can ever change this column again.
-- The card cover now derives live from the first gallery photo
-- (`gallery->0->>'card'`) in the read queries; see web/lib/db/cafes/reads.ts.
alter table cafes
  drop column if exists cover;
