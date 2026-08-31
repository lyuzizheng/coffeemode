"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

export function CheckinSuccess({ cafeName }: { cafeName: string }) {
  const reduceMotion = useReducedMotion();
  const t = useTranslations("checkIn");

  if (reduceMotion) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
            <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-lg font-medium">{t("checkedIn")}</p>
        <p className="text-sm text-muted">{cafeName}</p>
      </div>
    );
  }

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

        {/* Steam strokes */}
        <motion.div
          className="absolute -top-3 left-1/2 h-6 w-px -translate-x-2 bg-foreground/40"
          style={{ borderRadius: 1 }}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: -6, opacity: [0, 0.6, 0] }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        >
          <svg width={6} height={18} viewBox="0 0 6 18" className="overflow-visible">
            <path d="M3 18c0-4 2-5 0-9M3 9c0-3 1.5-4 0-7" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" className="text-muted" />
          </svg>
        </motion.div>
        <motion.div
          className="absolute -top-3 left-1/2 translate-x-1 bg-foreground/40"
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: -6, opacity: [0, 0.6, 0] }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.23 }}
        >
          <svg width={6} height={18} viewBox="0 0 6 18" className="overflow-visible">
            <path d="M3 18c0-4 2-5 0-9M3 9c0-3 1.5-4 0-7" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" className="text-muted" />
          </svg>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.2 }}
        className="text-lg font-medium"
      >
        {t("checkedIn")}
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.3 }}
        className="text-sm text-muted"
      >
        {cafeName}
      </motion.p>
    </div>
  );
}
