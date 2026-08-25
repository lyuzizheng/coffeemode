"use client";

import { cn } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MAX_STAY_VALUES } from "@/types/checkins";
import { Section } from "../shared";

type PolicyOption = { key: string; label: string };

type PolicyChipsProps = {
  label: string;
  options: readonly PolicyOption[];
  selected: string;
  onSelect: (key: string) => void;
};

export function PolicyChips({ label, options, selected, onSelect }: PolicyChipsProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(({ key, label: optionLabel }) => (
          <button
            key={key}
            type="button"
            aria-pressed={selected === key}
            onClick={() => onSelect(key)}
            className={cn(
              "cm-focus h-9 rounded-sm border px-3 text-xs font-medium transition-colors duration-150",
              selected === key
                ? "border-secondary bg-secondary text-secondary-foreground"
                : "border-border bg-surface-secondary text-foreground hover:bg-surface-tertiary"
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PolicyChipsSection() {
  const t = useTranslations("themePreview.policyChips");
  const ts = useTranslations("search");

  const [maxStay, setMaxStay] = useState<string>("unlimited");

  const maxStayOptions: PolicyOption[] = MAX_STAY_VALUES.map((key) => ({
    key,
    label: ts(`maxStayOptions.${key}`),
  }));

  return (
    <Section index="09" title={t("title")} desc={t("desc")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <PolicyChips
          label={ts("maxStay")}
          options={maxStayOptions}
          selected={maxStay}
          onSelect={setMaxStay}
        />
      </div>
    </Section>
  );
}
