"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Route-segment error boundary (spec 0002: error states are designed, not raw
 * text). Renders inside the root layout, so theme + intl providers still
 * apply. `retry()` re-fetches AND re-renders the segment (Next 16 `retry`,
 * not `reset` — the home page's data lives in an async server component, so
 * a transient fetch failure only recovers via the re-fetch). The home link
 * is the escape hatch.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("error");

  useEffect(() => {
    // Keep the real error in the console; the UI stays calm and generic.
    console.error(error);
  }, [error]);

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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={retry}
          className="cm-focus h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-hover"
        >
          {t("retry")}
        </button>
        <Link
          href="/"
          className="cm-focus flex h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-secondary"
        >
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
