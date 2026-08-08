"use client";

import { Button, Label, ListBox, Select, Slider, Switch } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "../shared";
import { PolicyChips } from "./policy-chips-section";

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

function ThresholdSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <Slider
        value={value}
        onChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        minValue={0}
        maxValue={100}
        aria-label={label}
      >
        <div className="flex items-baseline justify-between">
          <Label>{label}</Label>
          <Slider.Output className="tnum font-mono text-md font-medium text-accent" />
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
    </div>
  );
}

export function SearchFilterSection() {
  const t = useTranslations("themePreview.searchFilter");
  const ts = useTranslations("search");
  const tc = useTranslations("checkIn");

  const [city, setCity] = useState<string>("tokyo");
  const [minSpend, setMinSpend] = useState<string>("none");
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
    setMinSpend("none");
    setMaxStay("unlimited");
    setOpenNow(true);
    const reset: Partial<Thresholds> = {};
    for (const d of DIMENSIONS) {
      reset[d.key] = d.defaultValue;
    }
    setThresholds(reset as Thresholds);
  };

  const minSpendOptions = [
    "none",
    "drink",
    "s5",
    "s10",
    "s10plus",
    "unknown",
  ].map((key) => ({ key, label: ts(`minSpendOptions.${key}`) }));

  const maxStayOptions = [
    "unlimited",
    "3h",
    "2h",
    "1h",
    "peak",
    "unknown",
  ].map((key) => ({ key, label: ts(`maxStayOptions.${key}`) }));

  return (
    <Section index="12" title={t("title")} desc={t("desc")}>
      <div className="mx-auto w-full max-w-2xl rounded-md border border-border bg-surface p-5">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* City */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{ts("city")}</Label>
            <Select.Root
              fullWidth
              selectedKey={city}
              onSelectionChange={(key) => setCity(key === null ? "" : String(key))}
            >
              <Select.Trigger>
                <Select.Value>
                  {({ selectedText }) => selectedText || ts("city")}
                </Select.Value>
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
              <ThresholdSlider
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
            label={ts("minSpend")}
            options={minSpendOptions}
            selected={minSpend}
            onSelect={setMinSpend}
          />
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
      </div>
    </Section>
  );
}
