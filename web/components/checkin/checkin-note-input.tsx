"use client";

import { useTranslations } from "next-intl";
import { getCheckinNoteMaxChars } from "@/lib/client-env";

interface CheckinNoteInputProps {
  value: string;
  onChange: (val: string) => void;
}

export function CheckinNoteInput({ value, onChange }: CheckinNoteInputProps) {
  const t = useTranslations("checkIn");
  // Server enforces the same cap (`checkins.noteMaxChars`); this only clamps early for UX.
  const noteMaxChars = getCheckinNoteMaxChars();

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted">{t("noteOptional")}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, noteMaxChars))}
        placeholder={t("notePlaceholder")}
        rows={3}
        className="min-h-[72px] w-full resize-none rounded-md border border-border bg-surface p-3 text-base placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        maxLength={noteMaxChars}
      />
    </div>
  );
}
