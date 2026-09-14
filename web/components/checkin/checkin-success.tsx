"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { duration, ease, stagger } from "@/lib/motion";
import type { CheckInScores } from "@/types/checkins";

/** The five work dimensions, in slider order — overall is the Experience
 *  score, not a WorkBar peer (artifact §3.2). */
const WORK_DIMS = ["wifi", "outlets", "seats", "temp", "coffee"] as const;

/**
 * Mini WorkBar (artifact §4 step 2): the submitted dimension values animate
 * in under the success title — 300ms fill, 40ms stagger, the WorkProfile
 * rhyme. Reduced motion renders them settled.
 */
function MiniWorkBar({
  label,
  value,
  delay,
  animate,
}: {
  label: string;
  value: number;
  delay: number;
  animate: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 truncate text-left text-xs text-muted">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-tertiary">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${value}%` }}
          transition={
            animate ? { duration: duration.transition, ease: ease.default, delay } : { duration: 0 }
          }
        />
      </div>
      <span className="tnum w-6 shrink-0 text-right font-mono text-xs text-foreground">
        {value}
      </span>
    </div>
  );
}

function SubmittedWorkBars({ scores, animate }: { scores: CheckInScores; animate: boolean }) {
  const t = useTranslations("checkIn");
  const entries = WORK_DIMS.flatMap((key) => {
    const value = scores[key];
    return value === undefined ? [] : [{ key, label: t(key), value }];
  });
  if (entries.length === 0) return null;
  return (
    <div className="flex w-56 flex-col gap-1.5">
      {entries.map((entry, i) => (
        <MiniWorkBar
          key={entry.key}
          label={entry.label}
          value={entry.value}
          delay={stagger.checkinSuccess.bars + i * stagger.workProfile.step}
          animate={animate}
        />
      ))}
    </div>
  );
}

function SteamStroke({ delay, offset }: { delay: number; offset: string }) {
  return (
    <motion.div
      className={`absolute -top-3 left-1/2 bg-foreground/40 ${offset}`}
      style={{ borderRadius: 1 }}
      initial={{ y: 6, opacity: 0 }}
      animate={{ y: -6, opacity: [0, 0.6, 0] }}
      transition={{ duration: duration.slow, ease: ease.default, delay }}
    >
      <svg width={6} height={18} viewBox="0 0 6 18" className="overflow-visible">
        <path
          d="M3 18c0-4 2-5 0-9M3 9c0-3 1.5-4 0-7"
          stroke="currentColor"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          className="text-muted"
        />
      </svg>
    </motion.div>
  );
}

function AnimatedSuccess({ cafeName, scores }: { cafeName: string; scores: CheckInScores }) {
  const t = useTranslations("checkIn");
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      {/* Cup + steam */}
      <div className="relative">
        <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden className="text-foreground">
          <path
            d="M7 18c0 3 2.5 5 6 5s6-2 6-5V8H7v10z"
            stroke="currentColor"
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M19 11h3a2 2 0 010 4h-3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" />
          <path d="M7 8h12" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" opacity={0.3} />
        </svg>
        <SteamStroke delay={stagger.checkinSuccess.steamA} offset="h-6 w-px -translate-x-2" />
        <SteamStroke delay={stagger.checkinSuccess.steamB} offset="translate-x-1" />
      </div>

      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.state, delay: stagger.checkinSuccess.title }}
        className="text-lg font-medium"
      >
        {t("checkedIn")}
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: duration.state, delay: stagger.checkinSuccess.cafeName }}
        className="text-sm text-muted"
      >
        {cafeName}
      </motion.p>
      <SubmittedWorkBars scores={scores} animate />
    </div>
  );
}

export function CheckinSuccess({
  cafeName,
  scores = {},
}: {
  cafeName: string;
  scores?: CheckInScores;
}) {
  const reduceMotion = useReducedMotion();
  const t = useTranslations("checkIn");

  if (!reduceMotion) return <AnimatedSuccess cafeName={cafeName} scores={scores} />;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
          <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-lg font-medium">{t("checkedIn")}</p>
      <p className="text-sm text-muted">{cafeName}</p>
      <SubmittedWorkBars scores={scores} animate={false} />
    </div>
  );
}
