"use client";

/**
 * PEEK card / desktop sidebar row — one composition, two widths (artifact
 * §5.1 + §7). Scan-first: cover, name, meta, ≤4 characteristic facts, and
 * the decorative Work-score watermark (DG43). No actions in PEEK — the whole
 * card is the tap target.
 */
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  CoffeeIcon,
  OutletsIcon,
  SeatsIcon,
  StayIcon,
  TempIcon,
  WifiIcon,
  type IconProps,
} from "@/components/icons";
import { cafeFacts, formatDistanceKm, type Fact, type FactKind } from "@/lib/discovery/view-model";
import type { CafeSummary } from "@/types/cafes";

const FACT_ICONS: Record<FactKind, (props: IconProps) => React.ReactNode> = {
  wifi: WifiIcon,
  outlets: OutletsIcon,
  stay: StayIcon,
  seats: SeatsIcon,
  temp: TempIcon,
  coffee: CoffeeIcon,
};

/** Stay fact label: 3h/2h/1h pass through, unlimited → ∞, peak translates. */
function StayFactLabel({ value }: { value: string }) {
  const t = useTranslations("discovery");
  if (value === "unlimited") return <>∞</>;
  if (value === "peak") return <>{t("policy.max_stay.peak")}</>;
  return <>{value}</>;
}

/** Characteristic icon row: 14px icons + text-xs values, never icon-only. */
export function FactsRow({ facts }: { facts: Fact[] }) {
  const t = useTranslations("discovery");
  if (facts.length === 0) return null;
  return (
    <div className="flex items-center gap-3">
      {facts.map((fact) => {
        const Icon = FACT_ICONS[fact.kind];
        return (
          <span key={fact.kind} className="flex items-center gap-1 text-xs text-muted">
            <Icon size={14} />
            <span className="tnum">
              {fact.kind === "stay" ? <StayFactLabel value={fact.value} /> : fact.value}
            </span>
            <span className="sr-only">{t(`facts.${fact.kind}`)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Meta line: `area · 1.2 km` + exact Work value at the end (DG43). */
export function CardMeta({ cafe }: { cafe: CafeSummary }) {
  const t = useTranslations("discovery");
  const km = formatDistanceKm(cafe.distance_m);
  const work =
    cafe.work_stats.composite_score === null
      ? null
      : Math.round(cafe.work_stats.composite_score);
  const parts = [cafe.city, km !== null ? t("km_away", { km }) : null].filter(Boolean);
  return (
    <p className="truncate text-xs text-muted">
      {parts.join(" · ")}
      {work !== null && (
        <>
          {parts.length > 0 ? " · " : ""}
          {t("work")} <span className="tnum">{work}</span>
        </>
      )}
    </p>
  );
}

/**
 * Card body shared by the PEEK carousel and the desktop sidebar list. The
 * watermark is a non-content graphic: aria-hidden, pointer-events disabled,
 * 7% opacity, clipped by the card radius (spec 0004 §5 exemption).
 */
export function CafeCardBody({ cafe }: { cafe: CafeSummary }) {
  const work =
    cafe.work_stats.composite_score === null
      ? null
      : Math.round(cafe.work_stats.composite_score);
  return (
    <div className="relative flex gap-3 overflow-hidden rounded-md border border-separator bg-surface p-3 shadow-sm">
      <div className="relative h-[66px] w-[88px] shrink-0 overflow-hidden rounded-md border border-separator bg-surface-tertiary">
        {cafe.cover && (
          <Image
            src={cafe.cover}
            alt=""
            fill
            sizes="88px"
            className="object-cover"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <h3 className="truncate font-display text-md font-bold text-foreground">{cafe.name}</h3>
        <CardMeta cafe={cafe} />
        <FactsRow facts={cafeFacts(cafe)} />
      </div>
      {work !== null && (
        <span
          aria-hidden
          className="tnum pointer-events-none absolute -right-1 top-1/2 -translate-y-1/2 select-none text-[4rem] font-extralight leading-none text-foreground/[0.07]"
        >
          {work}
        </span>
      )}
    </div>
  );
}
