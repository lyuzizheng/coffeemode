"use client";

import { useTranslations } from "next-intl";
import { Section, Swatch } from "../shared";

const BASE_TOKENS = [
  "background",
  "foreground",
  "surface",
  "surface-secondary",
  "surface-tertiary",
  "overlay",
  "muted",
  "border",
  "separator",
  "default",
  "default-hover",
  "default-soft",
];
const BRAND_TOKENS = [
  "accent",
  "accent-hover",
  "accent-soft",
  "accent-soft-foreground",
];
const STATUS_TOKENS = [
  "success",
  "success-soft",
  "warning",
  "warning-soft",
  "danger",
  "danger-soft",
];

export function ColorSection() {
  const t = useTranslations("themePreview.color");
  const groups: [string, string[]][] = [
    [t("group_base"), BASE_TOKENS],
    [t("group_brand"), BRAND_TOKENS],
    [t("group_status"), STATUS_TOKENS],
  ];
  return (
    <Section index="01" title={t("title")} desc={t("desc")}>
      <div className="space-y-8">
        {groups.map(([label, tokens]) => (
          <div key={label}>
            <h3 className="mb-3 text-sm font-medium text-foreground">
              {label}
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
              {tokens.map((token) => (
                <Swatch key={token} token={token} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
