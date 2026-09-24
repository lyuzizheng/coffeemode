"use client";

/**
 * Search filter UI atoms (search-filters-v1 §3–§5, DG44–DG58):
 *
 * - `CityScopeSelect` — the `Singapore ▾` scope chip at the left end of the
 *   search row; city is scope, not a filter (DG50).
 * - `FilterButton` — funnel glyph + active-count badge (`· 3`) pinned at the
 *   right end of the search row; the badge is text, never a bare dot.
 * - `SearchFilterControls` — the panel body shared by the mobile bottom
 *   sheet and the desktop inline section: Open-now switch first (DG53),
 *   six tri-state `Any/60+/80+` dimension segments, then the max-stay
 *   PolicyChips group (`unknown` deliberately absent — spec §4).
 * - `ActiveFilterChips` — removable chips above results (DG54); removing a
 *   chip clears that filter and the live-apply refetch follows.
 *
 * Every control mutates the single `SearchFilterState` object — badge,
 * chips, panel, and URL can never disagree.
 */
import { useSyncExternalStore } from "react";
import { Button, Label, ListBox, Select, Switch } from "@heroui/react";
import { useLocale, useTranslations } from "next-intl";
import { displayCityName, LAUNCH_CITIES } from "@/lib/cities";
import {
  getOnboardingStateServerSnapshot,
  getOnboardingStateSnapshot,
  subscribeOnboardingStore,
} from "@/lib/onboarding-store";
import {
  CoffeeIcon,
  FilterIcon,
  OutletsIcon,
  SeatsIcon,
  SparkleIcon,
  TempIcon,
  WifiIcon,
  type IconProps,
} from "@/components/icons";
import type { WorkDim } from "@/lib/stats/work-stats";
import {
  countActiveFilters,
  DIM_THRESHOLDS,
  MAX_STAY_FILTER_VALUES,
  type DimThreshold,
  type MaxStayFilter,
  type SearchFilterState,
} from "@/lib/search/search-filters";

/** Characteristic-icon set (discovery-sheet-v1 §2) — `stay` has no dimension
 * row; `overall` uses the sparkle glyph like `scores.tsx`. */
const DIM_ICONS: Record<WorkDim, (props: IconProps) => React.ReactNode> = {
  wifi: WifiIcon,
  outlets: OutletsIcon,
  seats: SeatsIcon,
  temp: TempIcon,
  coffee: CoffeeIcon,
  overall: SparkleIcon,
};

const DIM_ORDER: WorkDim[] = ["wifi", "outlets", "seats", "temp", "coffee", "overall"];

/** `Singapore ▾` — compact scope chip at the left end of the search row. */
export function CityScopeSelect({
  city,
  onCityChange,
}: {
  /** Effective city id — a launch-city id or a runtime city (DG121). */
  city: string | undefined;
  onCityChange: (cityId: string) => void;
}) {
  const t = useTranslations("search");
  const locale = useLocale();
  // BRAWUKA-696: the persisted runtime-city name lives in the onboarding
  // store (anonymous localStorage + the signed-in profile mirror), so the
  // chip upgrades from the country fallback without a prop thread.
  const stored = useSyncExternalStore(
    subscribeOnboardingStore,
    getOnboardingStateSnapshot,
    getOnboardingStateServerSnapshot,
  );
  const runtimeName = stored !== null && stored.currentCity === city ? stored.currentCityName : null;
  return (
    <Select
      aria-label={t("city")}
      selectedKey={city ?? null}
      onSelectionChange={(key) => {
        if (key != null) onCityChange(String(key));
      }}
    >
      <Select.Trigger className="h-9 shrink-0 gap-1 rounded-sm border border-separator bg-surface-secondary px-2.5 text-sm text-foreground">
        <Select.Value>{displayCityName(city, locale, runtimeName) || t("city")}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {LAUNCH_CITIES.map((c) => (
            <ListBox.Item key={c.id} id={c.id} textValue={displayCityName(c.id, locale)}>
              {displayCityName(c.id, locale)}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Funnel + active-count badge at the right end of the search row. */
export function FilterButton({
  filters,
  expanded,
  onPress,
}: {
  filters: SearchFilterState;
  /** `aria-expanded` — true while the panel (sheet or inline) is open. */
  expanded: boolean;
  onPress: () => void;
}) {
  const t = useTranslations("search");
  const active = countActiveFilters(filters);
  return (
    <button
      type="button"
      onClick={onPress}
      aria-expanded={expanded}
      aria-label={active > 0 ? t("filters_active", { count: active }) : t("filters")}
      className="cm-focus -my-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm text-foreground transition-colors hover:bg-surface-secondary"
    >
      <FilterIcon size={14} />
      <span>{t("filters")}</span>
      {active > 0 && <span className="text-muted">· {active}</span>}
    </button>
  );
}


/** Roving-tabindex arrow-key navigation for the spec §9 radiogroups —
 * ←/→ (and ↑/↓) move focus and select, matching ARIA radio semantics. */
function handleRadioGroupKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const group = event.currentTarget;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  const index = radios.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const next = radios[(index + delta + radios.length) % radios.length];
  next.focus();
  next.click();
}

/** One `Any/60+/80+` tri-state segment row — radiogroup semantics (spec §9). */
function DimSegmentRow({
  dim,
  label,
  value,
  onChange,
}: {
  dim: WorkDim;
  label: string;
  value: number | undefined;
  onChange: (threshold: DimThreshold | undefined) => void;
}) {
  const Icon = DIM_ICONS[dim];
  const t = useTranslations("search");
  const options: { key: string; threshold: DimThreshold | undefined; label: string }[] = [
    { key: "any", threshold: undefined, label: t("any") },
    ...DIM_THRESHOLDS.map((threshold) => ({
      key: String(threshold),
      threshold,
      label: `${threshold}+`,
    })),
  ];
  return (
    <div className="flex min-h-11 items-center gap-3 py-1">
      <span className="flex w-28 shrink-0 items-center gap-1.5 text-sm text-foreground">
        <Icon size={14} />
        <span className="truncate">{label}</span>
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={handleRadioGroupKeyDown}
        className="flex gap-0.5 rounded-md bg-surface-secondary p-0.5"
      >
        {options.map((option) => {
          const activeOption = option.threshold === value;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              tabIndex={activeOption ? 0 : -1}
              aria-checked={activeOption}
              onClick={() => onChange(option.threshold)}
              className="group cm-focus -my-1 flex min-h-11 items-center"
            >
              <span
                className={`rounded-sm px-2.5 py-1 text-xs transition-colors duration-120 ${
                  activeOption
                    ? "border border-separator bg-surface font-medium text-foreground"
                    : "border border-transparent text-muted group-hover:text-foreground"
                }`}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Panel body — shared verbatim by the mobile sheet and the desktop inline
 * section so control order never diverges (spec §11). `resultCount` is the
 * live count in the header; `onReset` renders only when ≥1 filter is on. */
export function SearchFilterControls({
  filters,
  resultCount,
  onFiltersChange,
  onReset,
}: {
  filters: SearchFilterState;
  /** Live result count shown in the header (`12 places`, tabular). */
  resultCount: number | null;
  onFiltersChange: (next: SearchFilterState) => void;
  onReset: () => void;
}) {
  const t = useTranslations("search");
  const active = countActiveFilters(filters);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-bold text-foreground">{t("filters")}</span>
        <span className="flex items-center gap-2">
          {resultCount !== null && (
            <span className="text-sm tabular-nums text-muted">
              {t("results_count", { count: resultCount })}
            </span>
          )}
          {active > 0 && (
            <Button variant="ghost" size="sm" onPress={onReset}>
              {t("reset")}
            </Button>
          )}
        </span>
      </div>

      {/* Open now — always first (time-sensitive intent, spec §4). Label and
          control both live inside Switch.Content: the .switch root is
          flex-col, so a sibling control would stack under the label. */}
      <Switch
        isSelected={filters.openNow}
        onChange={(openNow) => onFiltersChange({ ...filters, openNow })}
        className="min-h-12 py-1"
      >
        <Switch.Content className="w-full justify-between">
          <Label className="text-sm text-foreground">{t("openNow")}</Label>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>

      {/* One column — the 380px sidebar can't fit two segment rows. */}
      <div className="grid gap-x-4">
        {DIM_ORDER.map((dim) => (
          <DimSegmentRow
            key={dim}
            dim={dim}
            label={t(`dims.${dim}`)}
            value={filters.thresholds[dim]}
            onChange={(threshold) => {
              const thresholds = { ...filters.thresholds };
              if (threshold === undefined) delete thresholds[dim];
              else thresholds[dim] = threshold;
              onFiltersChange({ ...filters, thresholds });
            }}
          />
        ))}
      </div>

      <MaxStayChips filters={filters} onFiltersChange={onFiltersChange} />
    </div>
  );
}

/** Max-stay chip row — `Any` plus the four spec buckets (DG46). */
function MaxStayChips({
  filters,
  onFiltersChange,
}: {
  filters: SearchFilterState;
  onFiltersChange: (next: SearchFilterState) => void;
}) {
  const t = useTranslations("search");
  return (
    <div className="flex flex-col gap-2 pt-1">
      <span className="text-sm text-foreground">{t("maxStay")}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("maxStay")} onKeyDown={handleRadioGroupKeyDown}>
        {[{ key: "any", value: null }, ...MAX_STAY_FILTER_VALUES.map((v) => ({ key: v, value: v }))].map(
          (option) => {
            const activeOption = filters.maxStay === option.value;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                tabIndex={activeOption ? 0 : -1}
                aria-checked={activeOption}
                onClick={() => onFiltersChange({ ...filters, maxStay: option.value as MaxStayFilter | null })}
                className="group cm-focus -my-1 flex min-h-11 items-center"
              >
                <span
                  className={`flex h-9 items-center rounded-sm border px-3 text-xs font-medium transition-colors duration-150 ${
                    activeOption
                      ? "border-secondary bg-secondary text-secondary-foreground"
                      : "border-border bg-surface-secondary text-foreground group-hover:bg-surface-tertiary"
                  }`}
                >
                  {option.value === null ? t("any") : t(`maxStayOptions.${option.value}`)}
                </span>
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}

/** Removable chips above results (DG54) — one per active filter. */
export function ActiveFilterChips({
  filters,
  onFiltersChange,
}: {
  filters: SearchFilterState;
  onFiltersChange: (next: SearchFilterState) => void;
}) {
  const t = useTranslations("search");
  if (countActiveFilters(filters) === 0) return null;

  const chips: { key: string; label: string; clear: () => SearchFilterState }[] = [];
  if (filters.openNow) {
    chips.push({
      key: "open_now",
      label: t("openNow"),
      clear: () => ({ ...filters, openNow: false }),
    });
  }
  for (const dim of DIM_ORDER) {
    const threshold = filters.thresholds[dim];
    if (threshold === undefined) continue;
    chips.push({
      key: `dim_${dim}`,
      label: `${t(`dims.${dim}`)} ${threshold}+`,
      clear: () => {
        const thresholds = { ...filters.thresholds };
        delete thresholds[dim];
        return { ...filters, thresholds };
      },
    });
  }
  if (filters.maxStay !== null) {
    chips.push({
      key: "max_stay",
      label: `${t("maxStay")} · ${t(`maxStayOptions.${filters.maxStay}`)}`,
      clear: () => ({ ...filters, maxStay: null }),
    });
  }

  return (
    <ul className="flex gap-2 overflow-x-auto px-3 py-1" aria-label={t("filters")}>
      {chips.map((chip) => (
        <li key={chip.key} className="shrink-0">
          <button
            type="button"
            onClick={() => onFiltersChange(chip.clear())}
            aria-label={t("remove_filter", { label: chip.label })}
            className="group cm-focus -my-1 flex min-h-11 items-center"
          >
            <span className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs text-foreground transition-colors group-hover:bg-surface-tertiary">
              {chip.label}
              <span aria-hidden className="text-muted">✕</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
