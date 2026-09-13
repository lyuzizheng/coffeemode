"use client";

/**
 * Persistent locate control (onboarding-v1 §4, DG116/DG117/DG120): the only
 * geolocation surface after the welcome card — and the only re-entry after
 * an OS-level denial. Bottom-right above the sheet on mobile; top-right
 * map corner on desktop (DG42). The glyph pulses once per tap while
 * locating; `located` keeps the accent until the user picks a city.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { LocateIcon } from "@/components/icons";

export function LocateButton({
  locating,
  located,
  pulseKey,
  onLocate,
}: {
  locating: boolean;
  /** Granted location is the current center — accent glyph (DG120). */
  located: boolean;
  /** Increments per tap; remounts the glyph so the pulse replays once. */
  pulseKey: number;
  onLocate: () => void;
}) {
  const t = useTranslations("onboarding");
  const reduced = useReducedMotion();

  return (
    <button
      type="button"
      aria-label={t("locate_aria")}
      onClick={onLocate}
      className="fixed bottom-[calc(172px+12px+env(safe-area-inset-bottom))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-md border border-separator bg-overlay shadow-map lg:bottom-auto lg:right-6 lg:top-6"
    >
      <motion.span
        key={pulseKey}
        initial={false}
        animate={
          locating && !reduced
            ? { scale: [1, 1.15, 1], opacity: [1, 0.55, 1] }
            : { scale: 1, opacity: 1 }
        }
        transition={{ duration: 1.2, ease: "easeInOut" }}
        className="flex"
      >
        <LocateIcon
          size={20}
          className={located ? "text-accent" : "text-muted"}
        />
      </motion.span>
    </button>
  );
}
