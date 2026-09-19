/**
 * Cafe-card row parts — server-safe (no client hooks beyond next-intl's
 * RSC-compatible `useTranslations`) so the SSR `/search` page and the cafe
 * shell reuse the same row language as the discovery surfaces without
 * paying hydration cost.
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
import type { Fact, FactKind } from "@/lib/discovery/view-model";
import { CARD_COVER_W_PX } from "@/lib/layout";
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

/**
 * Cover tile: the photo when one exists, else the cafe's monogram on a warm
 * tonal plate — a designed placeholder, never a bare gray box.
 */
export function CoverTile({ cafe, className }: { cafe: CafeSummary; className: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-sm border border-separator bg-surface-secondary ${className}`}
    >
      {cafe.cover ? (
        <Image src={cafe.cover} alt="" fill sizes={`${CARD_COVER_W_PX}px`} className="object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center font-display text-xl font-extrabold text-foreground/25 select-none"
        >
          {cafe.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}
