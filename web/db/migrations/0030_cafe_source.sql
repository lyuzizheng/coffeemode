-- CoffeeMode schema v30 (BRAWUKA-620 — cafe source marker; re-apply of BRAWUKA-295).
-- `cafes` is an accepted-risk product asset (BRAWUKA-260 pragmatic route):
-- name/coords/address/opening_hours kept permanently, `google_place_id`
-- kept indefinitely for dedupe per Google terms. `source` records the write
-- path ("user_confirmed" — user-confirmed submission, incl. Google-prefilled)
-- for narrative + future audit. Single value today: no CHECK enum, no index;
-- add the constraint when a second concrete source appears.
--
-- Numbering: 0028/0029 are taken by the open_now SQL chain (BRAWUKA-571);
-- this re-application lands on 0030. Existing rows keep `user_confirmed`
-- via the column default (backfill covered).
alter table cafes
  add column if not exists source text not null default 'user_confirmed';
