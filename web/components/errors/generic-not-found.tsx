"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Designed global 404 (spec 0002: error states are designed, not raw
 * text). Client component so it renders under the root layout's intl
 * provider and stays testable; same layout language as the offline page.
 */
export function GenericNotFound() {
  const t = useTranslations("notFound");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="tnum font-mono text-xs text-muted">{t("kicker")}</p>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">
          {t("body")}
        </p>
      </div>
      <Link
        href="/"
        className="cm-focus flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-hover"
      >
        {t("cta")}
      </Link>
    </main>
  );
}
