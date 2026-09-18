"use client";

/**
 * Zero-data profile onboarding card (BRAWUKA-504): when a signed-in user
 * has no check-ins yet, the profile renders this three-step starter
 * instead of four empty tabs — one quiet card, three deep links into the
 * map flow, and a skip that dismisses it permanently (DG39: no nag).
 *
 * Steps mirror the real first-run path: locate → find-or-create → first
 * check-in. Each CTA deep-links to the map with the matching affordance
 * primed (?locate=1 pulses the locate button, ?create=1 opens the
 * creation sheet).
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { spring } from "@/lib/motion";
import {
  ChevronRightIcon,
  CoffeeIcon,
  LocateIcon,
  PlusIcon,
} from "@/components/icons";

const STEPS = [
  { key: "locate", href: "/?locate=1", Icon: LocateIcon },
  { key: "create", href: "/?create=1", Icon: PlusIcon },
  { key: "checkin", href: "/", Icon: CoffeeIcon },
] as const;

export function ProfileOnboardingCard({ onSkip }: { onSkip: () => void }) {
  const t = useTranslations("profile");
  const reduced = useReducedMotion();

  return (
    <motion.section
      aria-label={t("guide_title")}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : spring.gentle}
      className="mt-6 flex flex-col gap-5 rounded-lg border border-separator bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t("guide_title")}
        </h2>
        <p className="text-sm leading-relaxed text-muted">{t("guide_body")}</p>
      </div>

      <ol className="flex flex-col gap-1">
        {STEPS.map(({ key, href, Icon }, index) => (
          <li key={key}>
            <Link
              href={href}
              className="cm-focus group flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-120 hover:bg-surface-secondary"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted transition-colors group-hover:bg-accent/10 group-hover:text-accent">
                <Icon size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {index + 1}. {t(`guide_${key}_title`)}
                </span>
                <span className="text-xs text-muted">{t(`guide_${key}_desc`)}</span>
              </span>
              <ChevronRightIcon size={14} className="shrink-0 text-muted transition-colors group-hover:text-accent" />
            </Link>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onSkip}
        className="cm-focus -my-1 self-start rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        {t("guide_skip")}
      </button>
    </motion.section>
  );
}
