// Open-now evaluation in the cafe's own timezone (issue #77).
//
// cafes.opening_hours is a wall-clock weekly template:
//   { mon: { open: "09:00", close: "18:00" }, ... }  (day keys mon..sun)
// Evaluating it in any timezone other than the cafe's is the bug this module
// exists to prevent — for a nomad checking cafes in another city, server or
// viewer time is simply wrong. Unknown inputs yield null (unknown), never a
// guessed boolean.

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

export interface DayHours {
  /** "HH:MM" 24-hour wall clock, cafe-local. */
  open: string;
  /** "HH:MM"; close <= open means the window spans midnight. */
  close: string;
}

export type WeeklyHours = Partial<Record<DayKey, DayHours | null>>;

/** Minutes since midnight, or null for anything that is not "HH:MM". */
function parseWallClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const DAY_KEY_SET: ReadonlySet<string> = new Set(DAY_KEYS);

/** Structural validation for the cafes.opening_hours jsonb shape. */
export function isValidWeeklyHours(value: unknown): value is WeeklyHours {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!DAY_KEY_SET.has(key)) return false;
    if (entry === null) continue; // explicit closed day
    if (typeof entry !== "object" || Array.isArray(entry)) return false;
    const { open, close } = entry as Record<string, unknown>;
    if (typeof open !== "string" || typeof close !== "string") return false;
    if (parseWallClock(open) === null || parseWallClock(close) === null) {
      return false;
    }
  }
  return true;
}

interface CafeLocalTime {
  day: DayKey;
  /** Minutes since midnight, cafe-local. */
  minutes: number;
}

function cafeLocalTime(tz: string, instant: Date): CafeLocalTime | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(instant);
  } catch {
    return null; // invalid IANA name
  }
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const rawHour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const day = weekday ? WEEKDAY_TO_KEY[weekday] : undefined;
  if (!day || Number.isNaN(rawHour) || Number.isNaN(minute)) return null;
  // ICU may render midnight as "24"; normalize to 0.
  const hour = rawHour === 24 ? 0 : rawHour;
  return { day, minutes: hour * 60 + minute };
}

/**
 * Whether the cafe is open at `instant`, evaluated in the cafe's timezone.
 * Returns null when tz or hours are missing/invalid — callers must render
 * "unknown", not a guess. Windows are [open, close); close <= open spans
 * midnight (yesterday's window still applies early the next day);
 * close === open reads as open around the clock.
 */
export function isOpenAt(
  hours: WeeklyHours | null | undefined,
  tz: string | null | undefined,
  instant: Date = new Date(),
): boolean | null {
  // jsonb can surface any shape at runtime — only a plain object is usable.
  if (typeof hours !== "object" || hours === null || !tz) return null;
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return null;
  const local = cafeLocalTime(tz, instant);
  if (!local) return null;

  const dayIndex = DAY_KEYS.indexOf(local.day);
  const yesterday = DAY_KEYS[(dayIndex + 6) % 7];
  const today = hours[local.day];
  const previous = hours[yesterday];

  if (today != null) {
    const open = parseWallClock(today.open);
    const close = parseWallClock(today.close);
    if (open === null || close === null) return null; // corrupt row → unknown
    if (close > open) {
      if (local.minutes >= open && local.minutes < close) return true;
    } else if (local.minutes >= open) {
      return true; // today's overnight portion
    }
  }

  if (previous != null) {
    const open = parseWallClock(previous.open);
    const close = parseWallClock(previous.close);
    if (open === null || close === null) return null;
    if (close <= open && local.minutes < close) return true; // yesterday's spillover
  }

  return false;
}
