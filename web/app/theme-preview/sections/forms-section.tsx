"use client";

import { Chip, Input, Label, SearchField, Switch, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ScoreSlider, Section } from "../shared";

export function FormsSection() {
  const t = useTranslations("themePreview.forms");
  const [openOnly, setOpenOnly] = useState(true);
  const [wifiScore, setWifiScore] = useState(72);
  const [coffeeScore, setCoffeeScore] = useState(91);
  return (
    <Section index="05" title={t("title")} desc={t("desc")}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <SearchField className="w-full" aria-label={t("search_placeholder")}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("search_placeholder")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <TextField className="w-full">
            <Label>{t("name_label")}</Label>
            <Input placeholder={t("name_placeholder")} />
          </TextField>

          <div className="rounded-xl border border-border bg-surface p-5">
            <Switch isSelected={openOnly} onChange={setOpenOnly} aria-label={t("open_only")}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Switch.Content>
                <Label>{t("open_only")}</Label>
              </Switch.Content>
            </Switch>
            <p className="mt-2 text-xs text-muted">{t("open_only_hint")}</p>
          </div>

          <div>
            <div className="mb-2 font-mono text-xs text-muted">
              {t("policy_label")}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip variant="secondary">{t("chip_minspend")}</Chip>
              <Chip variant="secondary">{t("chip_maxstay")}</Chip>
              <Chip color="success" variant="soft">
                {t("chip_laptops")}
              </Chip>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <ScoreSlider
            label={t("wifi_label")}
            hint={t("slider_hint")}
            value={wifiScore}
            onChange={setWifiScore}
          />
          <ScoreSlider
            label={t("coffee_label")}
            hint={t("slider_hint")}
            value={coffeeScore}
            onChange={setCoffeeScore}
          />
        </div>
      </div>
    </Section>
  );
}
