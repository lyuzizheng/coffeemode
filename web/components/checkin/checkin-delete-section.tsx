"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";

interface CheckinDeleteSectionProps {
  onDelete: () => void;
}

export function CheckinDeleteSection({ onDelete }: CheckinDeleteSectionProps) {
  const t = useTranslations("checkIn");
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="border-t border-separator pt-4">
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="text-sm text-danger hover:underline"
        >
          {t("deleteCheckin")}
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-3">
          <span className="text-sm">{t("deleteConfirm")}</span>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setShowConfirm(false)}
            className="ml-auto h-7 text-xs"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onPress={onDelete}
            className="h-7 bg-danger-solid text-white hover:bg-danger-solid/90 text-xs"
          >
            {t("delete")}
          </Button>
        </div>
      )}
    </div>
  );
}
