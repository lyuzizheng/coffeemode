"use client";

/**
 * Score blocks for the discovery dossier (BRAWUKA-364 field-guide redesign;
 * artifact §3 + §5.3).
 *
 * ScorePair is the verdict strip: Work is the hero plate — a tabular ink
 * numeral over a 2px accent rule — and Experience is always present, always
 * subordinate (sparkle + smaller numeral). Missing values never render as
 * 0 — a block with no responses collapses to the "Not enough check-ins"
 * line (DG10).
 *
 * WorkProfile bars print in sage — the plate-2 spot color reserved for
 * work-suitability signals (spec 0002 plate roles).
 */
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { SparkleIcon } from "@/components/icons";
import { stagger, useEnterMotion, useSprings } from "@/lib/motion";
import { COMPOSITE_DIMS, type WorkStats } from "@/lib/stats/work-stats";
import { MAX_STAY_VALUES, type MaxStay } from "@/types/checkins";
import { dimMean, policyConsensus } from "@/lib/discovery/view-model";
import { SectionLabel } from "./section-label";

/** Dimension label column — shared by WorkProfile rows and PolicyConsensus
 *  so the two tables align on the same 88px gutter. */
const DIM_LABEL_CLASS = "w-[88px] shrink-0 text-sm text-foreground";

function asMaxStay(value: string | null): MaxStay {
  return (MAX_STAY_VALUES as readonly string[]).includes(value ?? "")
    ? (value as MaxStay)
    : "unknown";
}

function RespondentCount({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  return (
    <span className="tnum font-mono text-xs text-muted">
      {t("checkins_count", { count: stats.n_checkins })}
    </span>
  );
}

/** Work | Experience verdict strip — the dossier's printed score plates. */
export function ScorePair({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  const work = stats.composite_score === null ? null : Math.round(stats.composite_score);
  const experience = stats.experience_score === null ? null : Math.round(stats.experience_score);

  if (work === null && experience === null) {
    return <p className="text-xs italic text-muted">{t("not_enough")}</p>;
  }

  return (
    <div className="flex items-stretch gap-5">
      {work !== null && (
        <div className="min-w-0">
          <div
            className="tnum font-mono text-2xl leading-none text-foreground"
            role="img"
            aria-label={t("work_score_aria", { score: work })}
          >
            {work}
          </div>
          <div
            aria-hidden
            className="mt-1.5 h-0.5 w-14 rounded-full bg-surface-tertiary"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${work}%` }}
            />
          </div>
          <div className="mt-1.5 font-mono text-xs uppercase tracking-[0.12em] text-muted">
            {t("work")} · <RespondentCount stats={stats} />
          </div>
        </div>
      )}
      {work !== null && experience !== null && (
        <div aria-hidden className="w-px self-stretch bg-separator" />
      )}
      {experience !== null && (
        <div className="min-w-0">
          <div className="flex items-center gap-1 pt-1 text-md text-foreground/80">
            <SparkleIcon size={14} />
            <span
              className="tnum"
              role="img"
              aria-label={t("experience_score_aria", { score: experience })}
            >
              {experience}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-xs uppercase tracking-[0.12em] text-muted">
            {t("experience")} · <RespondentCount stats={stats} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FULL WorkProfile — the dossier's data table: five dimension bars in sage
 * (plate-2 work-suitability spot), gentle spring staggered 40ms on entry
 * (spec 0002 Motion), reduced motion → final state instantly. A
 * zero-response dimension renders "Not enough check-ins", never a zero bar
 * (DG10). When EVERY dimension is empty the whole section collapses —
 * ScorePair already carries the single "Not enough check-ins" line, and
 * five identical rows would read as a bug (BRAWUKA-247).
 *
 * `animated={false}` is for the SSR cafe shell, where bars render at final
 * width with no entry motion (seo-sharing artifact §2).
 */
export function WorkProfile({ stats, animated = true }: { stats: WorkStats; animated?: boolean }) {
  const t = useTranslations("discovery");
  const enter = useEnterMotion() && animated;
  const springs = useSprings();
  const means = COMPOSITE_DIMS.map((dim) => dimMean(stats, dim));

  if (means.every((mean) => mean === null)) return null;

  return (
    <section aria-label={t("work_profile_aria")} className="flex flex-col gap-3">
      <SectionLabel>{t("work_profile_aria")}</SectionLabel>
      <div className="flex flex-col gap-2.5">
        {COMPOSITE_DIMS.map((dim, i) => {
          const mean = means[i];
          const n = stats.dims[dim]?.n ?? 0;
          return (
            <div key={dim} className="flex items-center gap-3">
              <span className={DIM_LABEL_CLASS}>
                {t(`dims.${dim}`)}
              </span>
              {mean === null ? (
                <span className="text-xs italic text-muted">{t("not_enough")}</span>
              ) : (
                <>
                  <div className="h-1.5 min-w-0 flex-1 rounded-full bg-surface-tertiary">
                    <motion.div
                      key={enter ? "m" : "s"}
                      className="h-full rounded-full bg-secondary"
                      {...(enter
                        ? {
                            initial: { width: 0 },
                            animate: { width: `${mean}%` },
                            transition: {
                              ...springs.gentle,
                              delay: i * stagger.workProfile.step,
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
      </div>
    </section>
  );
}

/** FULL policy consensus — Max stay row; unknown renders honestly. */
export function PolicyConsensus({ stats }: { stats: WorkStats }) {
  const t = useTranslations("discovery");
  const maxStay = asMaxStay(policyConsensus(stats, "max_stay"));
  return (
    <section className="flex flex-col gap-3" aria-label={t("policy_aria")}>
      <SectionLabel>{t("policy_aria")}</SectionLabel>
      <div className="flex items-center gap-3">
        <span className={DIM_LABEL_CLASS}>{t("max_stay")}</span>
        <span className="rounded-sm border border-separator bg-surface-secondary px-2.5 py-1 text-xs text-foreground">
          {t(`policy.max_stay.${maxStay}`)}
        </span>
      </div>
    </section>
  );
}
