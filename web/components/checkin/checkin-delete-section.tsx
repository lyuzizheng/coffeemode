"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DangerConfirm } from "@/components/danger-confirm";

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
          className="-my-2.5 inline-flex min-h-11 items-center text-sm text-danger hover:underline"
        >
          {t("deleteCheckin")}
        </button>
      ) : (
        <DangerConfirm
          message={t("deleteConfirm")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onCancel={() => setShowConfirm(false)}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}
