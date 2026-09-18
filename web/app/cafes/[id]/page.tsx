import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { isValidUUID } from "@shared/uuid";
import { SiteMasthead } from "@/components/site-masthead";
import { DossierHero } from "@/components/discovery/dossier-hero";
import { SectionLabel } from "@/components/discovery/section-label";
import { GalleryStrip } from "@/components/cafe/gallery-strip";
import { OpenState } from "@/components/cafe/open-state";
import { CreatorLine } from "@/components/discovery/creator-line";
import { PolicyConsensus, ScorePair, WorkProfile } from "@/components/discovery/scores";
import { getCurrentUser } from "@/lib/auth/get-user";
import { displayCityName } from "@/lib/cities";
import { getCafe, toPublicCafeDetail } from "@/lib/db/cafes";
import { profileFromUser } from "@/lib/auth/profiles";
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
import type { CafeDetail, PublicCafeDetail } from "@/types/cafes";
import type { StoredImage } from "@/types/images";

import { CafeDetailSeed } from "./cafe-detail-seed";
import { CafePageActions } from "./cafe-page-actions";
import { CafePageFeed } from "./cafe-page-feed";
import { CafeOwnerControls } from "@/components/cafe/cafe-owner-controls";
// DB-backed SSR page: render per request; the CDN cache header on /cafes/:id
// (next.config.ts, TTLs from web/config/app.yaml — DG105/DG107) absorbs the
// viral-link traffic so Postgres does not.
export const dynamic = "force-dynamic";

// React `cache` dedupes the lookup across generateMetadata + the page body
// within one request. notFound() must fire in generateMetadata: metadata
// resolves before the HTML shell flushes, which is what commits the real
// 404 status (DG19). A notFound() thrown only from the page body would be
// streamed with a 200 status.
// React `cache` dedupes the viewer lookup across loadCafe + the page body —
// one Supabase getUser() per request, not two.
const loadViewer = cache(async () => getCurrentUser());

const loadCafe = cache(async (id: string) => {
  if (!isValidUUID(id)) return null;
  const user = await loadViewer();
  return getCafe(id, user?.id);
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
  const locale = await getLocale();
  const cityName = displayCityName(cafe.city, locale);
  const origin = await getRequestOrigin();
  const url = `${origin}${cafeCanonicalPath(cafe.id)}`;
  const hook = ogHookParams(cafe.work_stats);
  const description = hook ? t("og_hook", hook) : t("og_hook_empty");
  const title = cityName ? `${cafe.name} · ${cityName}` : cafe.name;
  // DG108: og:title keeps the app name suffix; the first gallery card is the og:image,
  // with the dynamic fallback card when the cafe has no photo yet.
  const ogTitle = `${title} — ${APP_NAME}`;
  // Gallery card cover is the 400×300 card variant (CARD_SIZE, web/lib/images/processor.ts:43);
  // the dynamic /og-image fallback is 1200×630. Declare the honest dimensions per source
  // so share cards don't ship mismatched og:image:width/height.
  const coverOgImage = cafeOgImageUrl(cafe);
  const ogImage = coverOgImage ?? `${url}/og-image`;
  const ogImages = coverOgImage
    ? [{ url: ogImage, width: 400, height: 300, alt: cafe.name }]
    : [{ url: ogImage, width: 1200, height: 630, alt: cafe.name }];

  const isShell = cafe.work_stats?.n_checkins === 0;

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
      locale: locale === "zh" ? "zh_CN" : "en_US",
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
/** Title + meta + attribution block — the badge is owner-only (DG147).
    Props are the narrow public slices only: `openState` feeds the client
    `OpenState`, so a full `CafeDetail` here would serialize `created_by`,
    provider ids, and R2 keys into the served HTML (DG13). */
function CafeHeading({
  name,
  address,
  cityName,
  openState,
  isPrivate,
  privateBadge,
  author,
  maintainedByService,
}: {
  name: string;
  address: string | null;
  cityName: string | null;
  openState: { opening_hours: CafeDetail["opening_hours"]; tz: CafeDetail["tz"] };
  isPrivate: boolean;
  privateBadge: string;
  author: PublicCafeDetail["author"];
  maintainedByService: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-foreground">
          {name}
        </h1>
        {isPrivate && (
          <span className="rounded-sm bg-surface-secondary px-2.5 py-1 text-xs text-muted">
            {privateBadge}
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        {cityName && <span>{cityName}</span>}
        {cityName && address && <span aria-hidden>·</span>}
        {address && <span>{address}</span>}
        <OpenState cafe={openState} />
      </p>
      <CreatorLine author={author} maintainedByService={maintainedByService} />
    </div>
  );
}



export default async function CafePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cafe = await loadCafe(id);
  if (!cafe) notFound();
  const viewer = await loadViewer();
  // Owner view (DG146/DG147): delete + hide controls and the private badge
  // render only for the creator. Signed-in requests bypass the CDN shell
  // cache (sb-* cookie rule), so this never leaks into the shared shell.
  const isOwner = Boolean(viewer && cafe.created_by === viewer.id);
  const isPrivate = cafe.visibility === "private";

  const td = await getTranslations("discovery");
  const tc = await getTranslations("cafeDetail");
  const locale = await getLocale();
  const cityName = displayCityName(cafe.city, locale);
  const origin = await getRequestOrigin();
  const canonical = `${origin}${cafeCanonicalPath(cafe.id)}`;
  const covers = (cafe.gallery ?? []).map((g: StoredImage) => g.card).filter(Boolean); // BRAWUKA-307: cafe.cover already derives from the first gallery card
  // The public payload contract (DG13): client components receive only the
  // narrow slices, never the full row (see publicCafeShell).
  const publicAttribution = toPublicCafeDetail(cafe, viewer?.id);
  const shell = publicCafeShell(cafe);
  const accountInitial = viewer
    ? profileFromUser(viewer).displayName[0]?.toUpperCase()
    : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteMasthead accountInitial={accountInitial} />

      {/* Part 1 — the public shell (DG106): aggregate product data only,
          full semantic HTML, no client JS needed for the content. */}
      <main className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-1 flex-col gap-6 px-4 pb-12 pt-5 sm:px-6">
        <DossierHero covers={covers} name={cafe.name} />

        <CafeHeading
          name={cafe.name}
          address={cafe.address}
          cityName={cityName}
          openState={shell.openState}
          isPrivate={isPrivate}
          privateBadge={tc("private_badge")}
          author={publicAttribution.author}
          maintainedByService={publicAttribution.maintained_by_service}
        />
        <ScorePair stats={cafe.work_stats} />
        {/* SSR → client cache seed (BRAWUKA-283 P2-3): skips the detail re-fetch. */}
        <CafeDetailSeed cafe={publicAttribution} />
        <CafePageActions cafe={shell.actions} cafeId={cafe.id} shareUrl={canonical} />
        {/* SSR shell: bars at final width, no entry motion (artifact §2). */}
        <WorkProfile stats={cafe.work_stats} animated={false} />
        <PolicyConsensus stats={cafe.work_stats} />
        {shell.gallery.length > 0 && (
          <section aria-label={td("gallery_aria")} className="flex flex-col gap-3">
            <SectionLabel>{td("gallery_aria")}</SectionLabel>
            <GalleryStrip photos={shell.gallery} ariaLabel={td("gallery_aria")} />
          </section>
        )}

        {/* DG105: JSON-LD for crawlers and AI search engines. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(cafeJsonLd(cafe, canonical)) }}
        />

        {/* Part 2 — the check-in feed (DG106): user content loads from the
            public API after paint, never embedded in the initial HTML. */}
        <CafePageFeed cafeId={cafe.id} cafeName={cafe.name} />
        {isOwner && (
          <CafeOwnerControls
            cafeId={cafe.id}
            initialVisibility={cafe.visibility ?? "public"}
            hasCheckins={(cafe.work_stats?.n_checkins ?? 0) > 0}
          />
        )}
      </main>
    </div>
  );
}
