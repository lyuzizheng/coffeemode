-- CafeMood schema v24 (BRAWUKA-278 — rename service-account display_name).
update profiles
set display_name = 'CafeMood'
where id = '00000000-0000-4000-a000-000000000001'
  and display_name = 'CoffeeMode';
