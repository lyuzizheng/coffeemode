/**
 * DG46 rich result row (search-filters-v1 §6 "results view") — server-safe
 * (no "use client") so the SSR `/search` page renders it with zero
 * hydration while the map panel's submitted results view reuses the same
 * row language.
 *
 * Row language: 72px 4:3 cover (photo; monogram plate for coverless cafes;
 * cup glyph for coverless POIs), display name, meta line
 * (`area · 1.2 km · Open until 22:00`), ≤4 characteristic facts for cafes
 * with work data, and the muted "Not on CafeMood yet" badge for POIs.
 * The parent owns the interactive wrapper — `Link` on the SSR page,
 * `button` in the panel — so this renders content only.
 */
import { useLocale, useTranslations } from "next-intl";
import { CoffeeIcon } from "@/components/icons";
import { CoverTile, FactsRow } from "@/components/discovery/card-parts";
import { cafeFacts, formatDistanceKm } from "@/lib/discovery/view-model";
import { displayCityName } from "@/lib/cities";
import { closingTimeToday, isOpenAt } from "@/lib/hours";
import type { SearchResultItem } from "@/lib/search/types";

/** 72px 4:3 cover — photo, monogram plate (cafes), or cup glyph (POIs). */
function ResultCover({ item }: { item: SearchResultItem }) {
  if (item.type === "cafe" && item.cafe) {
    return <CoverTile cafe={item.cafe} className="h-[var(--layout-thumb)] w-[var(--layout-card-cover-w)]" />;
  }
  return (
    <div
      aria-hidden
      className="flex h-[var(--layout-thumb)] w-[var(--layout-card-cover-w)] shrink-0 items-center justify-center rounded-sm border border-separator bg-surface-tertiary text-muted"
    >
      <CoffeeIcon size={20} />
    </div>
  );
}

/** `area · 1.2 km · Open until 22:00` — distance labeled when city-center anchored (DG58). */
function RowMeta({ item }: { item: SearchResultItem }) {
  const t = useTranslations("search");
  const tDiscovery = useTranslations("discovery");
  const locale = useLocale();

  const km = formatDistanceKm(item.distance_m);
  const cafe = item.type === "cafe" ? item.cafe : undefined;
  const open = cafe ? isOpenAt(cafe.opening_hours, cafe.tz) : null;
  const close = cafe && open === true ? closingTimeToday(cafe.opening_hours, cafe.tz) : null;

  const meta = [
    item.type === "cafe" ? displayCityName(cafe?.city, locale) || item.address : item.address,
    km !== null ? tDiscovery("km_away", { km }) : null,
    item.is_from_city_center && km !== null ? t("from_city_center") : null,
    open === true ? (close ? tDiscovery("open_until", { time: close }) : tDiscovery("open_now")) : null,
    open === false ? tDiscovery("closed") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!meta) return null;
  return <span className="tnum truncate text-xs text-muted">{meta}</span>;
}

export function SearchResultRichRow({ item }: { item: SearchResultItem }) {
  const t = useTranslations("search");
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <ResultCover item={item} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-md font-bold text-foreground">
            {item.name}
          </span>
          {item.type === "poi" && (
            <span className="shrink-0 text-xs text-muted">
              <span aria-hidden>+ </span>
              {t("not_on_coffeemode")}
            </span>
          )}
        </span>
        <RowMeta item={item} />
        {item.cafe && <FactsRow facts={cafeFacts(item.cafe)} />}
      </div>
    </div>
  );
}
