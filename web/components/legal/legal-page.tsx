import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRightIcon } from "@/components/icons";

/**
 * Shared legal/about page shell (BRAWUKA-504): quiet editorial column —
 * back link, display title, dated sections. Content lives in the i18n
 * catalogs (`legal.<page>.*`) so both languages ship from one file.
 */
export async function LegalPage({
  page,
  sections,
  values,
}: {
  /** i18n namespace under `legal` — "privacy" | "terms" | "about". */
  page: "privacy" | "terms" | "about";
  /** Ordered section keys rendered as titled paragraphs. */
  sections: string[];
  /** ICU values interpolated into every section body (e.g. app version). */
  values?: Record<string, string>;
}) {
  const t = await getTranslations(`legal.${page}`);
  const tSettings = await getTranslations("settings");

  return (
    <div className="flex min-h-screen flex-col items-center bg-background text-foreground">
      <main className="flex w-full max-w-[var(--layout-content-max)] flex-1 flex-col gap-6 px-4 py-6 md:px-6">
        <Link
          href="/settings"
          className="cm-focus -ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ChevronRightIcon size={14} className="rotate-180" />
          {tSettings("title")}
        </Link>

        <header className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-xs text-muted">{t("updated")}</p>
        </header>

        {sections.map((key) => (
          <section key={key} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">
              {/* Dynamic section keys — catalogs are the source of truth,
                  so the type-level key union can't enumerate them. */}
              {t(`${key}_title` as never)}
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              {t(`${key}_body` as never, values as never)}
            </p>
          </section>
        ))}
      </main>
    </div>
  );
}
