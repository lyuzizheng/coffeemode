-- CafeMood schema v28 (BRAWUKA-295 — cafe source marker).
-- `cafes` is an accepted-risk product asset (BRAWUKA-260 pragmatic route):
-- name/coords/address/opening_hours kept permanently, `google_place_id`
-- kept indefinitely for dedupe per Google terms. `source` records the write
-- path ("user_confirmed" — user-confirmed submission, incl. Google-prefilled)
-- for narrative + future audit. Single value today: no CHECK enum, no index;
-- add the constraint when a second concrete source appears.
alter table cafes
  add column if not exists source text not null default 'user_confirmed';
