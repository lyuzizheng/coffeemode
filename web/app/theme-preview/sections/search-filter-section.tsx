"use client";

import { Button, Label, ListBox, Select, Switch } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ScoreSlider, Section } from "../shared";
import { PolicyChips } from "./policy-chips-section";
import { MAX_STAY_VALUES } from "@/types/checkins";
import searchFixtures from "@/tests/fixtures/search-fixtures.json";
const CITIES = [
  { key: "tokyo" },
  { key: "shanghai" },
  { key: "taipei" },
  { key: "seoul" },
  { key: "berlin" },
] as const;

const DIMENSIONS = [
  { key: "wifi", labelKey: "wifi", defaultValue: 50 },
  { key: "outlets", labelKey: "outlets", defaultValue: 50 },
  { key: "seats", labelKey: "seats", defaultValue: 50 },
  { key: "temp", labelKey: "temp", defaultValue: 50 },
  { key: "coffee", labelKey: "coffee", defaultValue: 50 },
  { key: "overall", labelKey: "overall", defaultValue: 60 },
] as const;

type Thresholds = Record<(typeof DIMENSIONS)[number]["key"], number>;

export function SearchFilterSection() {
  const t = useTranslations("themePreview.searchFilter");
  const ts = useTranslations("search");
  const tc = useTranslations("checkIn");

  const [city, setCity] = useState<string>("tokyo");
  const [maxStay, setMaxStay] = useState<string>("unlimited");
  const [openNow, setOpenNow] = useState(true);
  const [thresholds, setThresholds] = useState<Thresholds>(() => {
    const initial: Partial<Thresholds> = {};
    for (const d of DIMENSIONS) {
      initial[d.key] = d.defaultValue;
    }
    return initial as Thresholds;
  });

  const handleThresholdChange = (key: keyof Thresholds, value: number) => {
    setThresholds((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setCity("tokyo");
    setMaxStay("unlimited");
    setOpenNow(true);
    const reset: Partial<Thresholds> = {};
    for (const d of DIMENSIONS) {
      reset[d.key] = d.defaultValue;
    }
    setThresholds(reset as Thresholds);
  };

  const maxStayOptions = MAX_STAY_VALUES.map((key) => ({
    key,
    label: ts(`maxStayOptions.${key}`),
  }));

  return (
    <Section index="12" title={t("title")} desc={t("desc")}>
      <div className="mx-auto w-full max-w-2xl rounded-md border border-border bg-surface p-5">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* City — Label lives inside Select.Root so it associates with the trigger */}
          <div>
            <Select.Root
              fullWidth
              placeholder={ts("city")}
              value={city}
              onChange={(key) => setCity(key === null ? "" : String(key))}
            >
              <Label>{ts("city")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {CITIES.map((c) => (
                    <ListBox.Item key={c.key} id={c.key}>
                      {ts(`cities.${c.key}`)}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select.Root>
          </div>

          {/* Open now */}
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-secondary p-4 lg:justify-start lg:gap-4">
            <span className="text-sm font-medium text-foreground">{ts("openNow")}</span>
            <Switch
              isSelected={openNow}
              onChange={setOpenNow}
              aria-label={ts("openNow")}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>

        {/* Dimension minima */}
        <div className="mt-6">
          <div className="mb-3 text-sm font-medium text-foreground">
            {ts("dimensionMinima")}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {DIMENSIONS.map((d) => (
              <ScoreSlider
                key={d.key}
                label={tc(d.labelKey)}
                value={thresholds[d.key]}
                onChange={(value) => handleThresholdChange(d.key, value)}
              />
            ))}
          </div>
        </div>

        {/* Policies */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <PolicyChips
            label={ts("maxStay")}
            options={maxStayOptions}
            selected={maxStay}
            onSelect={setMaxStay}
          />
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3 border-t border-separator pt-4">
          <Button variant="ghost" onPress={handleReset}>
            {ts("reset")}
          </Button>
          <Button variant="primary">{ts("filters")}</Button>
        </div>

        {/* DG140: Deterministic search fixtures preview for visual smoke & theme-preview */}
        <div className="mt-8 border-t border-separator pt-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">
              Fixtures Preview (3 Cafes + 3 Stored POIs + 1 Live Google)
            </span>
            <span className="font-mono text-xs text-muted">
              {searchFixtures.cafes.length + searchFixtures.pois.length} results
            </span>
          </div>
          <div className="space-y-2">
            {searchFixtures.cafes.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface-secondary px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{c.name}</span>
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
                      coffeemode
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted">{c.address}</div>
                </div>
                <div className="font-mono text-xs font-semibold text-accent">
                  {c.work_stats.composite_score}
                </div>
              </div>
            ))}
            {searchFixtures.pois.map((p) => {
              const tag =
                p.search_source === "google"
                  ? "google (live)"
                  : p.search_source === "apple" || p.source === "apple"
                    ? "apple"
                    : "stored_poi";
              return (
                <div
                  key={p.place_id}
                  className="flex items-center justify-between rounded-md border border-border bg-surface-secondary px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                      <span className="rounded bg-muted/20 px-1.5 py-0.5 text-xs font-medium text-muted">
                        {tag}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted">{p.address}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
