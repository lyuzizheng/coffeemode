-- CoffeeMode schema v16 (DG125 / issue #229 — seed service-account profile for community cafe handoff).
insert into profiles (id, display_name)
values ('00000000-0000-4000-a000-000000000001', 'CoffeeMode')
on conflict (id) do nothing;
