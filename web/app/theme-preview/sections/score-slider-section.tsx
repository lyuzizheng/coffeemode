"use client";

import { Label, Slider } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "../shared";

const DIMENSIONS = [
  { key: "overall", labelKey: "overall", labelNs: "checkIn", defaultValue: 82 },
  { key: "wifi", labelKey: "wifi", labelNs: "themePreview.cards.dims", defaultValue: 72 },
  { key: "outlets", labelKey: "outlets", labelNs: "themePreview.cards.dims", defaultValue: 64 },
  { key: "seats", labelKey: "seats", labelNs: "themePreview.cards.dims", defaultValue: 72 },
  { key: "temperature", labelKey: "temperature", labelNs: "themePreview.cards.dims", defaultValue: 58 },
  { key: "coffee", labelKey: "coffee", labelNs: "themePreview.cards.dims", defaultValue: 91 },
] as const;

type Scores = Record<(typeof DIMENSIONS)[number]["key"], number>;

function ScoreSlider({
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

export function ScoreSliderSection() {
  const t = useTranslations("themePreview.scoreSlider");
  const tCheckIn = useTranslations("checkIn");
  const tDims = useTranslations("themePreview.cards.dims");

  const [scores, setScores] = useState<Scores>(() => {
    const initial: Partial<Scores> = {};
    for (const d of DIMENSIONS) {
      initial[d.key] = d.defaultValue;
    }
    return initial as Scores;
  });

  const handleChange = (key: keyof Scores, value: number) => {
    setScores((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Section index="08" title={t("title")} desc={t("desc")}>
      <div className="grid gap-4 lg:grid-cols-2">
        {DIMENSIONS.map((d) => {
          const label =
            d.labelNs === "checkIn" ? tCheckIn(d.labelKey) : tDims(d.labelKey);
          return (
            <ScoreSlider
              key={d.key}
              label={label}
              value={scores[d.key]}
              onChange={(value) => handleChange(d.key, value)}
            />
          );
        })}
      </div>
    </Section>
  );
}
