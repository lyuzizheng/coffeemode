"use client";

import { useTranslations } from "next-intl";
import { CheckinSlider } from "./checkin-slider";
import type { CheckinScoresState } from "./use-checkin-scores";

interface CheckinScoresProps {
  state: CheckinScoresState;
  isEdit: boolean;
}

export function CheckinScores({ state, isEdit }: CheckinScoresProps) {
  const t = useTranslations("checkIn");

  return (
    <div className="flex flex-col gap-3">
      <CheckinSlider
        label={t("wifi")}
        value={state.wifi}
        onChange={state.setWifi}
        showClear={isEdit}
        onClear={() => state.setWifi(null)}
      />
      <CheckinSlider
        label={t("outlets")}
        value={state.outlets}
        onChange={state.setOutlets}
        showClear={isEdit}
        onClear={() => state.setOutlets(null)}
      />
      <CheckinSlider
        label={t("seats")}
        value={state.seats}
        onChange={state.setSeats}
        showClear={isEdit}
        onClear={() => state.setSeats(null)}
      />
      <CheckinSlider
        label={t("temp")}
        value={state.temp}
        onChange={state.setTemp}
        variant="temperature"
        showClear={isEdit}
        onClear={() => state.setTemp(null)}
      />
      <CheckinSlider
        label={t("coffee")}
        value={state.coffee}
        onChange={state.setCoffee}
        showClear={isEdit}
        onClear={() => state.setCoffee(null)}
      />

      <div className="border-t border-separator pt-3">
        <CheckinSlider
          label={t("overallExperience")}
          value={state.overall}
          onChange={state.setOverall}
          showClear={isEdit}
          onClear={() => state.setOverall(null)}
        />
      </div>
    </div>
  );
}
