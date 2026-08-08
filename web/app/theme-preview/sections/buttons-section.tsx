"use client";

import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Section } from "../shared";

export function ButtonsSection() {
  const t = useTranslations("themePreview.buttons");
  return (
    <Section index="03" title={t("title")} desc={t("desc")}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">{t("check_in")}</Button>
          <Button variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-secondary/90">
            {t("add_cafe")}
          </Button>
          <Button variant="tertiary">{t("save")}</Button>
          <Button variant="ghost">{t("cancel")}</Button>
          <Button variant="outline">{t("cancel")}</Button>
          <Button variant="danger">{t("delete")}</Button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-xs text-muted">
          <span>{t("variant_primary")}</span>
          <span>{t("variant_secondary")}</span>
          <span>{t("variant_tertiary")}</span>
          <span>{t("variant_ghost")}</span>
          <span>{t("variant_outline")}</span>
          <span>{t("variant_danger")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-separator pt-6">
          <span className="w-16 font-mono text-xs text-muted">{t("sizes")}</span>
          <Button size="sm" variant="primary">{t("check_in")}</Button>
          <Button size="md" variant="primary">{t("check_in")}</Button>
          <Button size="lg" variant="primary">{t("check_in")}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-separator pt-6">
          <span className="w-16 font-mono text-xs text-muted">{t("states")}</span>
          <Button variant="primary" isDisabled>
            {t("unavailable")}
          </Button>
          <Button variant="outline" isDisabled>
            {t("unavailable")}
          </Button>
        </div>
      </div>
    </Section>
  );
}
