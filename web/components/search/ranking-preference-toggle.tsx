"use client";

/**
 * DG136 ranking preference toggle — "更想探索好店 / 更想找最近的店".
 * Persisted to localStorage via `ranking-preference.ts` (anonymous-safe,
 * never `profiles`); `fetchUnifiedSearch` appends it as `?ranking=`.
 *
 * Two presentations, one control:
 * - `settings`: labelled block with description (profile preferences row).
 * - `compact`: single-line label + control (anonymous gate footer).
 *
 * BRAWUKA-516: the DG136 `onboarding` variant was removed — the welcome
 * card stays two actions (locate / city pick); ranking lives in settings
 * only.
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
  variant?: "settings" | "compact";
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
            className="group cm-focus -my-1.5 flex min-h-11 items-center"
          >
            <span
              className={`rounded-sm px-3 py-1.5 text-sm transition-colors duration-120 ${
                active
                  ? "border border-separator bg-surface font-medium text-foreground"
                  : "border border-transparent text-muted group-hover:text-foreground"
              }`}
            >
              {t(option)}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (variant === "compact") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{t("label")}</span>
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
