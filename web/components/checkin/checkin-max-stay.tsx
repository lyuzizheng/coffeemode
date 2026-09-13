"use client";

import { useTranslations } from "next-intl";
import { type MaxStay, MAX_STAY_VALUES } from "@/types/checkins";

interface CheckinMaxStayProps {
  value: MaxStay | null;
  onChange: (val: MaxStay | null) => void;
}

export function CheckinMaxStay({ value, onChange }: CheckinMaxStayProps) {
  const t = useTranslations("checkIn");
  const ts = useTranslations("search");

  const maxStayLabels = Object.fromEntries(
    MAX_STAY_VALUES.map((v) => [v, ts(`maxStayOptions.${v}`)]),
  ) as Record<string, string>;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{t("maxStay")}</div>
      <div className="flex flex-wrap gap-2">
        {MAX_STAY_VALUES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(value === option ? null : option)}
            className="group cm-focus relative -my-1 flex min-h-11 min-w-11 items-center justify-center"
          >
            <span
              className={`flex h-9 items-center rounded-sm border px-3 text-xs font-medium transition-colors ${
                value === option
                  ? "border-accent bg-surface text-accent"
                  : "border-border bg-surface-secondary text-foreground group-hover:bg-surface-tertiary"
              }`}
            >
              {maxStayLabels[option] ?? option}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
