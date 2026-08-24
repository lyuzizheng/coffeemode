"use client";

/**
 * Open-now state line: success dot + "Open until 22:00", danger dot +
 * "Closed". Shared by the discovery sheet and the SSR cafe page — open-now
 * evaluation is the same everywhere (spec 0001, issue #77). Unknown hours
 * render nothing, never a guess.
 */
import { useTranslations } from "next-intl";
import { closingTimeToday, isOpenAt, type WeeklyHours } from "@/lib/hours";

export function OpenState({
  cafe,
}: {
  cafe: { opening_hours: WeeklyHours | null; tz: string | null };
}) {
  const t = useTranslations("discovery");
  const open = isOpenAt(cafe.opening_hours, cafe.tz);
  if (open === null) return null; // unknown hours render nothing, never a guess
  const close = open ? closingTimeToday(cafe.opening_hours, cafe.tz) : null;
  return (
    <span className={`flex items-center gap-1 ${open ? "text-success" : "text-danger"}`}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {open
        ? close
          ? t("open_until", { time: close })
          : t("open_now")
        : t("closed")}
    </span>
  );
}
