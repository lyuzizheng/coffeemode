"use client";

import { Button, Drawer } from "@heroui/react";
import { useTranslations } from "next-intl";
import type { ViewState } from "./use-checkin-mutation";

interface CheckinFormFooterProps {
  view: ViewState;
  isEdit: boolean;
  canSubmit: boolean;
  isOffline: boolean;
  overallIsNull: boolean;
  onSubmit: () => void;
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
    <Drawer.Footer className="shrink-0 flex-col items-stretch border-t border-separator bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Button
        variant="primary"
        className="w-full h-12 rounded-sm text-base font-medium"
        isDisabled={!canSubmit || isOffline}
        onPress={onSubmit}
      >
        {view === "submitting" ? t("saving") : isEdit ? t("saveChanges") : t("submit")}
      </Button>
      {!canSubmit && overallIsNull && view === "form" && (
        <p className="mt-2 text-center text-xs text-muted">{t("overallHint")}</p>
      )}
      {isOffline && <p className="mt-2 text-center text-xs text-muted">{t("offline")}</p>}
    </Drawer.Footer>
  );
}
