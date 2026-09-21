-- CoffeeMode schema v28 (BRAWUKA-25 / #293 Stage 3, DG145-C: open_now SQL pushdown).
--
-- Replaces the bounded iterative fetch (10 x dbFetchCap batches + in-memory
-- isOpenAt) with a predicate evaluated in the cafe's own timezone. The
-- contract is exact parity with web/lib/hours.ts:isOpenAt:
--   * windows are [open, close); close <= open spans midnight and
--     yesterday's spillover counts early the next day;
--   * close === open reads as open around the clock;
--   * missing/invalid hours, corrupt day entries, or an unusable tz yield
--     NULL (excluded by the WHERE clause) — never an error.
-- A now()-dependent predicate cannot be indexed, so no tsrange/GIST
-- migration: a STABLE function over the existing opening_hours jsonb + tz
-- columns is the whole change.

-- "HH:MM" wall clock -> minutes since midnight; NULL for anything else
-- (mirrors parseWallClock: 1-2 digit hour <= 23, 2-digit minute <= 59).
create or replace function cafe_hhmm_minutes(value text)
returns int
language sql
immutable
as $$
  select case
           when m[1]::int <= 23 and m[2]::int <= 59
           then m[1]::int * 60 + m[2]::int
         end
  from (select regexp_match(value, '^([0-9]{1,2}):([0-9]{2})$') as m) r
  where m is not null
$$;

-- Whether the cafe is open at `instant`, evaluated in the cafe's timezone.
-- Returns NULL (never raises) when tz or hours are missing/invalid —
-- callers must exclude the row, not guess. Mirrors isOpenAt exactly,
-- including the corrupt-entry precedence: a present-but-unparseable day
-- entry yields NULL even when yesterday's spillover would cover the
-- instant.
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
    -- windowCovers: [open, close); close <= open -> minutes >= open
    -- (overnight portion or around the clock when close = open).
    if (t_c > t_o and mins >= t_o and mins < t_c)
       or (t_c <= t_o and mins >= t_o) then
      return true;
    end if;
  end if;

  if prev_j is not null and prev_j <> 'null'::jsonb then
    p_o := cafe_hhmm_minutes(prev_j ->> 'open');
    p_c := cafe_hhmm_minutes(prev_j ->> 'close');
    if p_o is null or p_c is null then
      return null;
    end if;
    if p_c <= p_o and mins < p_c then
      return true; -- yesterday's overnight spillover
    end if;
  end if;

  return false;
end;
$$;
