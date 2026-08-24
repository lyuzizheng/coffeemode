"use client";

/**
 * Score blocks for the discovery sheet (artifact §3 + §5.3).
 *
 * Work Score is the hero: text-xl accent numeral with a 2px accent bar whose
 * width is the score %, rhyming with the WorkProfile bars. Experience is
 * always present, always subordinate (sparkle + smaller numeral). Missing
 * values never render as 0 — a block with no responses collapses to the
 * "Not enough check-ins" line (DG10).
 */
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { SparkleIcon } from "@/components/icons";
import { duration, ease, useEnterMotion } from "@/lib/motion";
import { COMPOSITE_DIMS, type WorkStats } from "@/lib/stats/work-stats";
import { MAX_STAY_VALUES, MIN_SPEND_VALUES, type MaxStay, type MinSpend } from "@/types/checkins";
import { dimMean, policyConsensus } from "@/lib/discovery/view-model";

/** Narrow a raw consensus string to the policy's enum, else "unknown". */
function asMinSpend(value: string | null): MinSpend {
  return (MIN_SPEND_VALUES as readonly string[]).includes(value ?? "")
    ? (value as MinSpend)
    : "unknown";
}
function asMaxStay(value: string | null): MaxStay {
  return (MAX_STAY_VALUES as readonly string[]).includes(value ?? "")
    ? (value as MaxStay)
    : "unknown";
}

function RespondentCount({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  return (
    <span className="tnum text-xs text-muted">
      {t("checkins_count", { count: stats.n_checkins })}
    </span>
  );
}

/** Work | Experience pair, side by side with a 1px separator rule. */
export function ScorePair({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  const work = stats.composite_score === null ? null : Math.round(stats.composite_score);
  const experience = stats.experience_score === null ? null : Math.round(stats.experience_score);

  if (work === null && experience === null) {
    return <p className="text-xs italic text-muted">{t("not_enough")}</p>;
  }

  return (
    <div className="flex items-stretch gap-4">
      {work !== null && (
        <div className="min-w-0">
          <div
            className="tnum text-xl text-accent"
            role="img"
            aria-label={t("work_score_aria", { score: work })}
          >
            {work}
          </div>
          <div
            aria-hidden
            className="mt-1 h-0.5 rounded-full bg-surface-tertiary"
            style={{ width: "3rem" }}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${work}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-muted">
            {t("work")} · <RespondentCount stats={stats} />
          </div>
        </div>
      )}
      {work !== null && experience !== null && (
        <div aria-hidden className="w-px self-stretch bg-separator" />
      )}
      {experience !== null && (
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm text-foreground/80">
            <SparkleIcon size={14} />
            <span
              className="tnum"
              role="img"
              aria-label={t("experience_score_aria", { score: experience })}
            >
              {experience}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {t("experience")} · <RespondentCount stats={stats} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FULL WorkProfile — the visual hero: five dimension bars, staggered 40ms on
 * entry, reduced motion → final state instantly. A zero-response dimension
 * renders "Not enough check-ins", never a zero bar (DG10).
 */
export function WorkProfile({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  const enter = useEnterMotion();

  return (
    <section aria-label={t("work_profile_aria")} className="flex flex-col gap-2.5">
      {COMPOSITE_DIMS.map((dim, i) => {
        const mean = dimMean(stats, dim);
        const n = stats.dims[dim]?.n ?? 0;
        return (
          <div key={dim} className="flex items-center gap-3">
            <span className="w-[88px] shrink-0 text-sm text-foreground">
              {t(`dims.${dim}`)}
            </span>
            {mean === null ? (
              <span className="text-xs italic text-muted">{t("not_enough")}</span>
            ) : (
              <>
                <div className="h-1.5 min-w-0 flex-1 rounded-full bg-surface-tertiary">
                  <motion.div
                    key={enter ? "m" : "s"}
                    className="h-full rounded-full bg-accent"
                    {...(enter
                      ? {
                          initial: { width: 0 },
                          animate: { width: `${mean}%` },
                          transition: {
                            duration: duration.transition,
                            ease: ease.default,
                            delay: i * 0.04,
                          },
                        }
                      : { initial: false, style: { width: `${mean}%` } })}
                  />
                </div>
                <span className="tnum w-7 shrink-0 text-right text-sm text-foreground">
                  {mean}
                </span>
                <span className="tnum shrink-0 whitespace-nowrap text-right text-xs text-muted">
                  {t("responses", { count: n })}
                </span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** FULL policy consensus — Min spend / Max stay rows; unknown renders honestly. */
export function PolicyConsensus({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  const minSpend = asMinSpend(policyConsensus(stats, "min_spend"));
  const maxStay = asMaxStay(policyConsensus(stats, "max_stay"));
  const rows = [
    { label: t("min_spend"), text: t(`policy.min_spend.${minSpend}`) },
    { label: t("max_stay"), text: t(`policy.max_stay.${maxStay}`) },
  ];
  return (
    <section className="flex flex-col gap-2" aria-label={t("policy_aria")}>
      {rows.map(({ label, text }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-[88px] shrink-0 text-sm text-foreground">{label}</span>
          <span className="rounded-sm bg-surface-secondary px-2.5 py-1.5 text-xs text-foreground">
            {text}
          </span>
        </div>
      ))}
    </section>
  );
}
