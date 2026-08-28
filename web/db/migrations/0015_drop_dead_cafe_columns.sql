-- CoffeeMode schema v15 (issue #253 — drop dead columns cafes.owner_id and cafes.slug).
alter table cafes
  drop column if exists owner_id,
  drop column if exists slug;
