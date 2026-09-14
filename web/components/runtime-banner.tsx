"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { fetchRuntimeConfig, pickBannerText, selectLiveBanner } from "@/lib/runtime-banners";

/**
 * Runtime announcement banner (BRAWUKA-284): operator-editable notices via
 * `GET /api/config`, no redeploy. Client-read so SSR stays on the critical
 * path; the edge cache (s-maxage=60) bounds origin load.
 *
 * Manifesto principle 3: only operational notices (maintenance, outage,
 * feature, editorial) — never promos, upsells, or induced sharing. The
 * `kind` is a marker, not server copy: the UI renders catalog text, so
 * `check:i18n` sees every user-visible string.
 */
export function RuntimeBanner() {
  const t = useTranslations("runtime");
  const locale = useLocale();
  const [text, setText] = useState<string | null>(null);
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRuntimeConfig().then((config) => {
      if (cancelled || !config) return;
      const banner = selectLiveBanner(config.banners);
      if (!banner) return;
      setText(pickBannerText(banner, locale) || null);
      setHref(typeof banner.href === "string" && banner.href.length > 0 ? banner.href : null);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!text) return null;

  const body = (
    <span className="mx-auto inline-flex max-w-screen-sm items-center gap-2">
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current opacity-70" />
      {text}
    </span>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="safe-area-inset-top fixed left-0 right-0 top-0 z-50 bg-secondary px-4 py-2 text-center text-sm font-medium text-secondary-foreground"
    >
      {href ? (
        <a href={href} className="underline decoration-current/50 underline-offset-2">
          {body}
        </a>
      ) : (
        body
      )}
      <span className="sr-only">{t("announcement")}</span>
    </div>
  );
}
