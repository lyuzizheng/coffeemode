import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { isValidUUID } from "@shared/uuid";
import { ThemeToggle } from "@/components/theme-toggle";
import { CoverCarousel } from "@/components/cafe/cover-carousel";
import { GalleryStrip } from "@/components/cafe/gallery-strip";
import { OpenState } from "@/components/cafe/open-state";
import { PolicyConsensus, ScorePair, WorkProfile } from "@/components/discovery/scores";
import { getCafe } from "@/lib/db/cafes";
import {
  cafeCanonicalPath,
  cafeJsonLd,
  cafeOgImageUrl,
  ogHookParams,
  publicCafeShell,
  serializeJsonLd,
} from "@/lib/seo";
import { getRequestOrigin } from "@/lib/site-origin";
import { APP_NAME } from "@/lib/site";
import { CafePageActions } from "./cafe-page-actions";
import { CafePageFeed } from "./cafe-page-feed";

// DB-backed SSR page: render per request; the CDN cache header on /cafes/:id
// (next.config.ts, TTLs from web/config/app.yaml — DG105/DG107) absorbs the
// viral-link traffic so Postgres does not.
export const dynamic = "force-dynamic";

// React `cache` dedupes the lookup across generateMetadata + the page body
// within one request. notFound() must fire in generateMetadata: metadata
// resolves before the HTML shell flushes, which is what commits the real
// 404 status (DG19). A notFound() thrown only from the page body would be
// streamed with a 200 status.
const loadCafe = cache(async (id: string) => {
  if (!isValidUUID(id)) return null;
  return getCafe(id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const cafe = await loadCafe(id);
  if (!cafe) notFound(); // real 404, before streaming starts (DG19)

  const t = await getTranslations("cafeDetail");
  const origin = await getRequestOrigin();
  const url = `${origin}${cafeCanonicalPath(cafe.id)}`;
  const hook = ogHookParams(cafe.work_stats);
  const description = hook ? t("og_hook", hook) : t("og_hook_empty");
  const title = cafe.city ? `${cafe.name} · ${cafe.city}` : cafe.name;
  // DG108: og:title keeps the app name suffix; the cover is the og:image,
  // with the dynamic fallback card when the cafe has no photo yet.
  const ogTitle = `${title} — ${APP_NAME}`;
  // Cover is the 400×300 card variant (CARD_SIZE, web/lib/images/processor.ts:43);
  // the dynamic /og-image fallback is 1200×630. Declare the honest dimensions per source
  // so share cards don't ship mismatched og:image:width/height.
  const coverOgImage = cafeOgImageUrl(cafe);
  const ogImage = coverOgImage ?? `${url}/og-image`;
  const ogImages = coverOgImage
    ? [{ url: ogImage, width: 400, height: 300, alt: cafe.name }]
    : [{ url: ogImage, width: 1200, height: 630, alt: cafe.name }];

  const isShell = (cafe.work_stats?.n_checkins ?? 0) === 0;

  return {
    title,
    description,
    ...(isShell ? { robots: { index: false, follow: true } } : {}),
    alternates: {
      // DG110: one permanent, locale-independent canonical URL per cafe.
      canonical: url,
      languages: { "x-default": url },
    },
    openGraph: {
      title: ogTitle,
      description,
      url,
      siteName: APP_NAME,
      type: "website",
      locale: (await getLocale()) === "zh" ? "zh_CN" : "en_US",
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [ogImage],
    },
  };
}

export default async function CafePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cafe = await loadCafe(id);
  if (!cafe) notFound();

  const td = await getTranslations("discovery");
  const origin = await getRequestOrigin();
  const canonical = `${origin}${cafeCanonicalPath(cafe.id)}`;
  const covers = (cafe.gallery ?? []).map((g) => g.card).filter(Boolean);
  if (covers.length === 0 && cafe.cover) covers.push(cafe.cover);
  // The public payload contract (DG13): client components receive only the
  // narrow slices, never the full row (see publicCafeShell).
  const shell = publicCafeShell(cafe);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-md font-extrabold tracking-tight text-foreground"
        >
          {APP_NAME}
        </Link>
        <ThemeToggle />
      </header>

      {/* Part 1 — the public shell (DG106): aggregate product data only,
          full semantic HTML, no client JS needed for the content. */}
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 pb-12 sm:px-6">
        <CoverCarousel images={covers} alt={cafe.name} />

        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
            {cafe.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            {cafe.city && <span>{cafe.city}</span>}
            {cafe.city && cafe.address && <span aria-hidden>·</span>}
            {cafe.address && <span>{cafe.address}</span>}
            <OpenState cafe={shell.openState} />
          </p>
        </div>
        <ScorePair stats={cafe.work_stats} />
        <CafePageActions cafe={shell.actions} cafeId={cafe.id} shareUrl={canonical} />
        {/* SSR shell: bars at final width, no entry motion (artifact §2). */}
        <WorkProfile stats={cafe.work_stats} animated={false} />
        <PolicyConsensus stats={cafe.work_stats} />
        <GalleryStrip photos={shell.gallery} ariaLabel={td("gallery_aria")} />

        {/* DG105: JSON-LD for crawlers and AI search engines. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(cafeJsonLd(cafe, canonical)) }}
        />

        {/* Part 2 — the check-in feed (DG106): user content loads from the
            public API after paint, never embedded in the initial HTML. */}
        <CafePageFeed cafeId={cafe.id} cafeName={cafe.name} />
      </main>
    </div>
  );
}
