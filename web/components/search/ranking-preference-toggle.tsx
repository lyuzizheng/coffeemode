"use client";

/**
 * DG136 ranking preference toggle — "更想探索好店 / 更想找最近的店".
 * Persisted to localStorage via `ranking-preference.ts` (anonymous-safe,
 * never `profiles`); `fetchUnifiedSearch` appends it as `?ranking=`.
 *
 * Two presentations, one control:
 * - `settings`: compact labelled row (profile preferences).
 * - `onboarding`: title + body copy first, control below (first-visit ask).
 */
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import {
  getRankingPreferenceServerSnapshot,
  getRankingPreferenceSnapshot,
  setRankingPreference,
  subscribeRankingPreference,
  type RankingPreference,
} from "@/lib/search/ranking-preference";

const OPTIONS: RankingPreference[] = ["relevance", "good_first"];

export function RankingPreferenceToggle({
  variant = "settings",
}: {
  variant?: "settings" | "onboarding";
}) {
  const t = useTranslations("search.ranking");
  const stored = useSyncExternalStore(
    subscribeRankingPreference,
    getRankingPreferenceSnapshot,
    getRankingPreferenceServerSnapshot,
  );
  // Unset means "server default" — the toggle still has to show a position,
  // so it mirrors the app.yaml default (relevance) until the user chooses.
  const effective = stored ?? "relevance";

  const control = (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className="flex w-fit gap-0.5 rounded-md bg-surface-secondary p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = option === effective;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setRankingPreference(option)}
            className={`cm-focus rounded-sm px-3 py-1.5 text-sm transition-colors duration-120 ${
              active
                ? "border border-separator bg-surface font-medium text-foreground"
                : "border border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t(option)}
          </button>
        );
      })}
    </div>
  );

  if (variant === "onboarding") {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-md font-bold text-foreground">{t("onboarding_title")}</h2>
        <p className="text-sm text-muted">{t("onboarding_body")}</p>
        {control}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{t("label")}</span>
      <p className="text-xs text-muted">{t("desc")}</p>
      {control}
    </div>
  );
}
