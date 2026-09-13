"use client";

/**
 * Shared destructive-action confirm box (0009 §5 — second use extracted from
 * CheckinDeleteSection + the cafe delete flow in BRAWUKA-31).
 *
 * Column layout: the message sits above the action row so longer localized
 * copy (zh handoff text) never crams against the buttons.
 */
import type { ReactNode } from "react";
import { Button } from "@heroui/react";

export function DangerConfirm({
  message,
  confirmLabel,
  cancelLabel,
  pending = false,
  onCancel,
  onConfirm,
}: {
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 p-3">
      <p className="text-sm text-foreground">{message}</p>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          isDisabled={pending}
          className="-my-1 text-xs"
        >
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={onConfirm}
          isDisabled={pending}
          className="-my-1 bg-danger-solid text-xs text-white hover:bg-danger-solid/90"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
