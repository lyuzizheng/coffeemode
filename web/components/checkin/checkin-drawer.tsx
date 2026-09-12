"use client";

import { useCallback, useState } from "react";
import { Button, Drawer } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { CheckinForm, CHECKIN_RESUME_PARAM } from "./checkin-form";
import type { PhotoUpload } from "./checkin-photos";
import { fetchLastCheckin, type LastCheckin } from "@/lib/checkin/last-checkin";
import { isUnauthorized } from "@/lib/http";
import type { CheckInScores, MaxStay } from "@/types/checkins";

export { CHECKIN_RESUME_PARAM };

type DrawerMode = "create" | "edit";

interface CheckinDrawerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  cafeId: string;
  cafeName: string;
  mode?: DrawerMode;
  editCheckinId?: string;
  initialScores?: CheckInScores;
  initialMaxStay?: MaxStay | null;
  initialNote?: string | null;
  /** Restored sign-in gate draft photos (DG66) — staged entries re-upload at publish. */
  initialPhotos?: PhotoUpload[];
  isAuthenticated?: boolean;
}

export function resolveRevisitCheckin(
  data: { checkin: LastCheckin | null; revisitWindowHours?: number } | undefined,
  now: number = Date.now(),
): LastCheckin | null {
  const checkin = data?.checkin;
  const windowHours = data?.revisitWindowHours;
  if (!checkin || typeof windowHours !== "number" || !(windowHours > 0)) return null;
  const ageMs = now - new Date(checkin.visited_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs >= windowHours * 3_600_000) return null;
  return checkin;
}

function useRevisitPreempt({
  isOpen,
  cafeId,
  mode,
  isDirty,
  lastCheckinData,
  editCheckinId,
}: {
  isOpen: boolean;
  cafeId: string;
  mode: DrawerMode;
  isDirty: boolean;
  lastCheckinData: { checkin: LastCheckin | null; revisitWindowHours?: number } | undefined;
  editCheckinId?: string;
}) {
  const [preempted, setPreempted] = useState<LastCheckin | null>(null);
  const [preemptScope, setPreemptScope] = useState<string | null>(null);
  const scope = isOpen ? `${cafeId}|${mode}` : null;
  if (scope !== preemptScope) {
    setPreemptScope(scope);
    setPreempted(null);
  }
  const revisit = mode === "create" ? resolveRevisitCheckin(lastCheckinData) : null;
  if (!preempted && revisit && !isDirty) {
    setPreempted(revisit);
  }
  const preempt = preempted ?? (revisit && !isDirty ? revisit : null);
  const effectiveMode: DrawerMode = preempt ? "edit" : mode;
  const effectiveEditId = mode === "edit" ? editCheckinId : preempt?.id;

  return {
    revisit,
    effectiveMode,
    effectiveEditId,
  };
}

function CheckinDiscardDialog({
  isOpen,
  onKeepEditing,
  onDiscard,
}: {
  isOpen: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("checkIn");
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-end justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-sm rounded-lg bg-surface p-4 shadow-lg">
        <p className="mb-4 text-sm font-medium">{t("discardTitle")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onKeepEditing}>
            {t("keepEditing")}
          </Button>
          <Button
            variant="primary"
            className="bg-danger text-white hover:bg-danger/90"
            onPress={onDiscard}
          >
            {t("discard")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function useCheckinDrawerState({
  isOpen,
  cafeId,
  mode,
  isAuthenticated,
  editCheckinId,
}: {
  isOpen: boolean;
  cafeId: string;
  mode: DrawerMode;
  isAuthenticated?: boolean;
  editCheckinId?: string;
}) {
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const lastCheckinQuery = useQuery({
    queryKey: ["last-checkin", cafeId],
    queryFn: () => fetchLastCheckin(cafeId),
    enabled: isOpen && mode !== "edit" && isAuthenticated !== false,
    staleTime: 60_000,
    retry: false,
  });

  const authProbeFailed = lastCheckinQuery.isError && isUnauthorized(lastCheckinQuery.error);

  const { revisit, effectiveMode, effectiveEditId } = useRevisitPreempt({
    isOpen,
    cafeId,
    mode,
    isDirty,
    lastCheckinData: lastCheckinQuery.data,
    editCheckinId,
  });

  const formKey = isOpen ? `${cafeId}-${effectiveMode}-${effectiveEditId ?? "new"}` : "closed";

  return {
    isDirty,
    setIsDirty,
    showDiscardConfirm,
    setShowDiscardConfirm,
    lastCheckinQuery,
    authProbeFailed,
    revisit,
    effectiveMode,
    effectiveEditId,
    formKey,
  };
}

export function CheckinDrawer({
  isOpen,
  onOpenChange,
  cafeId,
  cafeName,
  mode = "create",
  editCheckinId,
  initialScores,
  initialMaxStay,
  initialNote,
  initialPhotos,
  isAuthenticated,
}: CheckinDrawerProps) {
  const t = useTranslations("checkIn");
  const state = useCheckinDrawerState({
    isOpen,
    cafeId,
    mode,
    isAuthenticated,
    editCheckinId,
  });

  const handleCloseAttempt = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && state.isDirty) {
        state.setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, state],
  );

  return (
    <Drawer.Root isOpen={isOpen} onOpenChange={handleCloseAttempt}>
      <Drawer.Backdrop />
      <Drawer.Content placement="bottom" className="max-h-[92dvh] bg-overlay text-foreground">
        <Drawer.Dialog
          aria-label={state.effectiveMode === "edit" ? t("editTitle") : t("title")}
          className="flex max-h-[92dvh] flex-col"
        >
          {isOpen && (
            <CheckinForm
              key={state.formKey}
              cafeId={cafeId}
              cafeName={cafeName}
              mode={state.effectiveMode}
              editCheckinId={state.effectiveEditId}
              initialScores={initialScores ?? state.revisit?.scores}
              initialMaxStay={initialMaxStay ?? state.revisit?.max_stay ?? null}
              initialNote={initialNote ?? state.revisit?.note ?? null}
              initialPhotos={initialPhotos}
              isAuthenticated={isAuthenticated}
              lastCheckin={state.lastCheckinQuery.data?.checkin ?? null}
              authProbeFailed={state.authProbeFailed}
              lastCheckinLoaded={state.lastCheckinQuery.isSuccess}
              onClose={() => onOpenChange(false)}
              onDirtyChange={state.setIsDirty}
            />
          )}

          <CheckinDiscardDialog
            isOpen={state.showDiscardConfirm}
            onKeepEditing={() => state.setShowDiscardConfirm(false)}
            onDiscard={() => {
              state.setShowDiscardConfirm(false);
              onOpenChange(false);
            }}
          />
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Root>
  );
}
