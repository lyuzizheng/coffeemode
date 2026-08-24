import { describe, expect, it } from "vitest";
import { closingTimeToday, isOpenAt, type WeeklyHours } from "@/lib/hours";

// 2026-08-16 is a Sunday, 2026-08-17 a Monday.
const nineToSixMonday: WeeklyHours = {
  mon: { open: "09:00", close: "18:00" },
};

describe("isOpenAt — cafe-local timezone evaluation", () => {
  it("evaluates in the cafe's timezone, not server or viewer time", () => {
    // 00:00 UTC Monday = 09:00 KST Monday: open in Seoul while it is still
    // Sunday afternoon in London / evening in New York.
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("2026-08-17T00:00:00Z"))).toBe(true);
    // 23:59 UTC Sunday = 08:59 KST Monday: still closed in Seoul even though
    // UTC is one minute from Monday midnight.
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("2026-08-16T23:59:00Z"))).toBe(false);
    // 09:00 UTC Monday = 18:00 KST Monday: closing time, not mid-morning —
    // a naive UTC interpretation of the wall clock would wrongly say open.
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("2026-08-17T09:00:00Z"))).toBe(false);
  });

  it("proves IANA timezone handling across a DST boundary (not a fixed offset)", () => {
    // America/New_York springs forward 2026-03-08: EST (UTC-5) → EDT (UTC-4).
    // Same wall clock 09:00 Monday on both sides must both read open, at
    // UTC instants an hour apart — a fixed-offset implementation fails one.
    expect(isOpenAt(nineToSixMonday, "America/New_York", new Date("2026-03-02T14:00:00Z"))).toBe(true);
    expect(isOpenAt(nineToSixMonday, "America/New_York", new Date("2026-03-09T13:00:00Z"))).toBe(true);
  });

  it("handles overnight windows (close <= open spans midnight)", () => {
    const lateBar: WeeklyHours = { mon: { open: "22:00", close: "02:00" } };
    // Monday 23:00 KST = 14:00 UTC.
    expect(isOpenAt(lateBar, "Asia/Seoul", new Date("2026-08-17T14:00:00Z"))).toBe(true);
    // Tuesday 01:00 KST = Monday 16:00 UTC — yesterday's spillover.
    expect(isOpenAt(lateBar, "Asia/Seoul", new Date("2026-08-17T16:00:00Z"))).toBe(true);
    // Tuesday 03:00 KST = Monday 18:00 UTC — past the spillover.
    expect(isOpenAt(lateBar, "Asia/Seoul", new Date("2026-08-17T18:00:00Z"))).toBe(false);
  });

  it("treats open as inclusive and close as exclusive", () => {
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("2026-08-17T00:00:00Z"))).toBe(true); // 09:00 KST
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("2026-08-17T09:00:00Z"))).toBe(false); // 18:00 KST
  });

  it("returns null (unknown) instead of guessing on missing or invalid data", () => {
    const instant = new Date("2026-08-17T00:00:00Z");
    expect(isOpenAt(null, "Asia/Seoul", instant)).toBeNull();
    expect(isOpenAt(nineToSixMonday, null, instant)).toBeNull();
    expect(isOpenAt(nineToSixMonday, "Mars/Olympus", instant)).toBeNull();
    expect(isOpenAt({ mon: { open: "9am", close: "18:00" } }, "Asia/Seoul", instant)).toBeNull();
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("not a date"))).toBeNull();
  });

  it("reads a closed day as closed, not unknown", () => {
    // Tuesday has no entry at all → closed, a real answer.
    expect(isOpenAt(nineToSixMonday, "Asia/Seoul", new Date("2026-08-18T01:00:00Z"))).toBe(false); // Tue 10:00 KST
  });

  it("reads close === open as open around the clock", () => {
    const always: WeeklyHours = { mon: { open: "00:00", close: "00:00" } };
    expect(isOpenAt(always, "Asia/Seoul", new Date("2026-08-17T00:00:00Z"))).toBe(true); // Mon 09:00 KST
    expect(isOpenAt(always, "Asia/Seoul", new Date("2026-08-17T12:34:00Z"))).toBe(true); // Mon 21:34 KST
  });

  it("returns null for a non-object hours payload from malformed jsonb", () => {
    expect(isOpenAt("not-an-object" as unknown as WeeklyHours, "Asia/Seoul", new Date("2026-08-17T00:00:00Z"))).toBeNull();
  });
});

describe("closingTimeToday — the 'Open until 22:00' source (cafe-local)", () => {
  // Reuse the Seoul fixture: 2026-08-17T00:00:00Z is Monday 09:00 KST.
  it("returns today's close for a normal same-day window", () => {
    expect(
      closingTimeToday(nineToSixMonday, "Asia/Seoul", new Date("2026-08-17T00:00:00Z")),
    ).toBe("18:00");
  });

  it("returns yesterday's close while the overnight spillover owns the window", () => {
    const lateBar: WeeklyHours = { mon: { open: "22:00", close: "02:00" } };
    // Tuesday 01:00 KST (Monday 16:00 UTC) — still inside Monday's window.
    expect(
      closingTimeToday(lateBar, "Asia/Seoul", new Date("2026-08-17T16:00:00Z")),
    ).toBe("02:00");
  });

  it("returns null when closed, around the clock, or in tonight's overnight portion", () => {
    // Closed Tuesday.
    expect(
      closingTimeToday(nineToSixMonday, "Asia/Seoul", new Date("2026-08-18T01:00:00Z")),
    ).toBeNull();
    // 24h cafe has no same-day close to quote.
    const always: WeeklyHours = { mon: { open: "00:00", close: "00:00" } };
    expect(closingTimeToday(always, "Asia/Seoul", new Date("2026-08-17T00:00:00Z"))).toBeNull();
    // Monday 23:00 KST inside a 22:00→02:00 window: close is tomorrow, not today.
    const lateBar: WeeklyHours = { mon: { open: "22:00", close: "02:00" } };
    expect(
      closingTimeToday(lateBar, "Asia/Seoul", new Date("2026-08-17T14:00:00Z")),
    ).toBeNull();
  });

  it("returns null on unknown inputs instead of guessing", () => {
    expect(closingTimeToday(null, "Asia/Seoul", new Date())).toBeNull();
    expect(closingTimeToday(nineToSixMonday, null, new Date())).toBeNull();
    expect(
      closingTimeToday(nineToSixMonday, "Mars/Olympus", new Date("2026-08-17T00:00:00Z")),
    ).toBeNull();
  });
});
