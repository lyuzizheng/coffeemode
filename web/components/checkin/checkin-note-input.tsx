"use client";

import { useTranslations } from "next-intl";

interface CheckinNoteInputProps {
  value: string;
  onChange: (val: string) => void;
}

export function CheckinNoteInput({ value, onChange }: CheckinNoteInputProps) {
  const t = useTranslations("checkIn");

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted">{t("noteOptional")}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 500))}
        placeholder={t("notePlaceholder")}
        rows={3}
        className="min-h-[72px] w-full resize-none rounded-md border border-border bg-surface p-3 text-base placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        maxLength={500}
      />
    </div>
  );
}
