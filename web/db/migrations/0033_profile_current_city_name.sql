-- CoffeeMode schema v32 (BRAWUKA-696: precise runtime-city display name).
-- `current_city_name` is a display-only field: the client reverse-geocodes
-- the granted coordinates via MapKit JS and persists the locality name here.
-- It never feeds search scope, launch-city detection, or identity — a forged
-- value only mislabels the owner's own profile (self-harm-only, PM invariant).
-- Null for launch cities (findCity supplies their names) and for runtime
-- cities that have not been reverse-geocoded yet (country fallback applies).

alter table profiles
  add column if not exists current_city_name text;
