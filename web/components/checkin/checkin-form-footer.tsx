"use client";

import { Button, Drawer } from "@heroui/react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { duration, spring } from "@/lib/motion";
import type { ViewState } from "./use-checkin-mutation";

interface CheckinFormFooterProps {
  view: ViewState;
  isEdit: boolean;
  canSubmit: boolean;
  isOffline: boolean;
  overallIsNull: boolean;
  onSubmit: () => void;
}

/**
 * Artifact §4 step 1: on successful save the confirm button's label
 * crossfades (120ms) to a ✓ that draws itself in on spring.gentle, and the
 * background eases accent → secondary (sage) over 200ms. Reduced motion
 * renders the settled ✓ directly — the toast carries the confirmation.
 */
function SuccessButton({ outgoingLabel }: { outgoingLabel: string }) {
  const reduced = useReducedMotion();
  const check = (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
      {reduced ? (
        <path
          d="M4 10l4 4 8-8"
          stroke="currentColor"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <motion.path
          d="M4 10l4 4 8-8"
          stroke="currentColor"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ pathLength: { ...spring.gentle }, opacity: { duration: duration.feedback } }}
        />
      )}
    </svg>
  );
  return (
    <Button
      variant="primary"
      isDisabled
      className="relative h-12 w-full rounded-sm bg-secondary text-base font-medium text-secondary-foreground transition-colors duration-200"
    >
      {/* Label crossfade (120ms): the outgoing "Saving…" fades while the ✓
          draws itself in over it. */}
      {reduced ? null : (
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: duration.feedback }}
        >
          {outgoingLabel}
        </motion.span>
      )}
      {check}
    </Button>
  );
}

export function CheckinFormFooter({
  view,
  isEdit,
  canSubmit,
  isOffline,
  overallIsNull,
  onSubmit,
}: CheckinFormFooterProps) {
  const t = useTranslations("checkIn");

  return (
    <Drawer.Footer className="safe-area-inset-bottom -mx-6 shrink-0 flex-col items-stretch border-t border-separator bg-surface p-4">
      {view === "success" ? (
        <SuccessButton outgoingLabel={t("saving")} />
      ) : (
        <>
          <Button
            variant="primary"
            className="h-12 w-full rounded-sm text-base font-medium"
            isDisabled={!canSubmit || isOffline}
            onPress={onSubmit}
          >
            {view === "submitting" ? t("saving") : isEdit ? t("saveChanges") : t("submit")}
          </Button>
          {!canSubmit && overallIsNull && view === "form" && (
            <p className="text-center text-xs text-muted">{t("overallHint")}</p>
          )}
          {isOffline && <p className="text-center text-xs text-muted">{t("offline")}</p>}
        </>
      )}
    </Drawer.Footer>
  );
}
