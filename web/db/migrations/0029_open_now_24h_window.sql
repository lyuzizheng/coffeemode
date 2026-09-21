-- CoffeeMode schema v29 (BRAWUKA-571: close === open 24h window fix).
--
-- Supersedes migration 0028's cafe_is_open_at: `close === open`
-- (e.g. 09:00-09:00) reads as open around the clock, so the today-branch is
-- a standalone branch returning true instead of falling into the overnight
-- `t_c <= t_o and mins >= t_o` check, which wrongly read closed before the
-- anchor wall-clock time — and the yesterday-spillover branch uses strict
-- `p_c < p_o`, since a 24h day has no overnight tail into the next morning.
-- Exact parity with web/lib/hours.ts:windowCovers.
-- cafe_hhmm_minutes is unchanged and untouched here.

create or replace function cafe_is_open_at(
  hours jsonb,
  tz text,
  instant timestamptz
)
returns boolean
language plpgsql
stable
as $$
declare
  day_keys constant text[] := array['sun','mon','tue','wed','thu','fri','sat'];
  local_ts timestamp;
  day_idx int;
  mins int;
  today_j jsonb;
  prev_j jsonb;
  t_o int; t_c int;
  p_o int; p_c int;
begin
  if tz is null or tz = '' or jsonb_typeof(hours) is distinct from 'object' then
    return null;
  end if;

  -- Intl.DateTimeFormat throws on an invalid IANA name; AT TIME ZONE does
  -- the same. Catch it so a bad tz excludes the row instead of failing the
  -- whole query.
  begin
    local_ts := instant at time zone tz;
  exception when others then
    return null;
  end;

  -- isodow: Mon=1..Sun=7 -> %7 gives sun=0..sat=6, matching day_keys.
  day_idx := (extract(isodow from local_ts)::int % 7) + 1;
  mins := extract(hour from local_ts)::int * 60 + extract(minute from local_ts)::int;
  if mins is null then
    return null; -- infinite/invalid instant
  end if;

  today_j := hours -> day_keys[day_idx];
  prev_j := hours -> day_keys[((day_idx + 5) % 7) + 1];

  -- Explicit jsonb null (closed day) and absent key both read as "no entry".
  if today_j is not null and today_j <> 'null'::jsonb then
    t_o := cafe_hhmm_minutes(today_j ->> 'open');
    t_c := cafe_hhmm_minutes(today_j ->> 'close');
    if t_o is null or t_c is null then
      return null; -- corrupt row -> unknown
    end if;
    -- windowCovers: [open, close); close = open -> around the clock;
    -- close < open spans midnight (overnight portion: minutes >= open).
    if (t_c = t_o)
       or (t_c > t_o and mins >= t_o and mins < t_c)
       or (t_c < t_o and mins >= t_o) then
      return true;
    end if;
  end if;

  if prev_j is not null and prev_j <> 'null'::jsonb then
    p_o := cafe_hhmm_minutes(prev_j ->> 'open');
    p_c := cafe_hhmm_minutes(prev_j ->> 'close');
    if p_o is null or p_c is null then
      return null;
    end if;
    if p_c < p_o and mins < p_c then
      return true; -- yesterday's overnight spillover
    end if;
  end if;

  return false;
end;
$$;
