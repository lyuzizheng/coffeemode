"use client";

/**
 * DG17 inline failure row: previous content stays; the failed section shows
 * warning glyph + copy + outline Retry with a 200ms fade-in.
 */
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { WarningIcon } from "@/components/icons";
import { duration, ease } from "@/lib/motion";

export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useTranslations("discovery");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.state, ease: ease.default }}
      className="flex items-center gap-2 rounded-md border border-separator bg-surface p-3"
      role="alert"
    >
      <WarningIcon size={14} className="shrink-0 text-muted" />
      <span className="flex-1 text-sm text-foreground">{message}</span>
      <Button variant="outline" size="sm" onPress={onRetry}>
        {t("retry")}
      </Button>
    </motion.div>
  );
}
