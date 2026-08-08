"use client";

import { Button } from "@heroui/react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { duration, ease } from "@/lib/motion";
import { Section } from "../shared";

function CoffeeSteam() {
  const reduced = useReducedMotion() ?? false;
  if (reduced) return null;

  return (
    <svg
      className="h-9 w-9 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M7 19h10a2 2 0 0 0 2-2V9H5v8a2 2 0 0 0 2 2z"
        opacity="0.2"
        fill="currentColor"
        stroke="none"
      />
      <path d="M5 9h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9z" />
      <path d="M8 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2" />
      {[0, 1, 2].map((i) => (
        <motion.path
          key={i}
          d={`M${10 + i * 2} 5 C ${9 + i * 2} 3, ${11 + i * 2} 1, ${10 + i * 2} -1`}
          stroke="currentColor"
          strokeWidth="1"
          fill="none"
          initial={{ opacity: 0, y: 1 }}
          animate={{ opacity: [0, 0.5, 0], y: [0, -3, -6] }}
          transition={{
            duration: 0.4,
            repeat: Infinity,
            repeatType: "loop",
            delay: i * 0.1,
            ease: ease.default,
          }}
        />
      ))}
    </svg>
  );
}

export function CheckInSuccessSection() {
  const t = useTranslations("themePreview.checkInSuccess");
  const ts = useTranslations("success");
  const tc = useTranslations("themePreview.cards");
  const reduced = useReducedMotion() ?? false;

  const enter = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: duration.transition, ease: ease.default },
      };

  return (
    <Section index="10" title={t("title")} desc={t("desc")}>
      <motion.div
        {...enter}
        className="mx-auto w-full max-w-sm rounded-md border border-border bg-surface p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
              {tc("cafe_name")}
            </h3>
            <p className="text-sm text-muted">{tc("cafe_area")}</p>
          </div>
          <CoffeeSteam />
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-separator pt-4">
          <span className="text-sm text-muted">{ts("newWorkScore")}</span>
          <span className="tnum font-display text-2xl font-extrabold text-accent">
            87
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="primary" fullWidth>
            {ts("viewCafe")}
          </Button>
          <Button variant="outline" fullWidth>
            {ts("share")}
          </Button>
        </div>
      </motion.div>
    </Section>
  );
}
