"use client";

import { useCallback, useState } from "react";
import { Button, Drawer } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { CheckinForm, CHECKIN_RESUME_PARAM } from "./checkin-form";
import type { PhotoUpload } from "./checkin-photos";
import { fetchLastCheckin, type LastCheckin } from "@/lib/checkin/last-checkin";
import { isUnauthorized } from "@/lib/http";
import { useDrawerDetents, type DrawerDetents } from "./use-drawer-detents";
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
  /** DG92: the warm caption under the cafe name is scoped to opens from the
      navigation prompt (BRAWUKA-5) — every other entry point leaves it off. */
  promptCaption?: boolean;
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
            className="bg-danger text-danger-foreground hover:bg-danger/90"
            onPress={onDiscard}
          >
            {t("discard")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface CheckinDrawerState {
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  showDiscardConfirm: boolean;
  setShowDiscardConfirm: (show: boolean) => void;
  lastCheckinQuery: UseQueryResult<{ checkin: LastCheckin | null; revisitWindowHours?: number }>;
  authProbeFailed: boolean;
  revisit: LastCheckin | null;
  effectiveMode: DrawerMode;
  effectiveEditId?: string;
  formKey: string;
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
}): CheckinDrawerState {
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

/** The drawer's rendered surface: detent handle, form, and discard dialog. */
function CheckinDrawerSurface({
  props,
  state,
  detents,
  isOpen,
  onOpenChange,
  handleCloseAttempt,
}: {
  props: CheckinDrawerProps;
  state: CheckinDrawerState;
  detents: DrawerDetents;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  handleCloseAttempt: (nextOpen: boolean) => void;
}) {
  const t = useTranslations("checkIn");
  return (
    <Drawer.Root isOpen={isOpen} onOpenChange={handleCloseAttempt}>
      <Drawer.Backdrop />
      <Drawer.Content placement="bottom" className="max-h-[92dvh] bg-overlay text-foreground">
        <Drawer.Dialog
          aria-label={state.effectiveMode === "edit" ? t("editTitle") : t("title")}
          className={`flex max-h-[92dvh] flex-col${detents.expanded ? " h-[92dvh]" : ""}`}
        >
          {/* DG70 detent handle: drag up expands to 92dvh, drag down collapses
              to content height then dismisses. stopPropagation inside the hook
              keeps HeroUI's dismiss-only drag from seeing the gesture. */}
          <Drawer.Handle
            className="cursor-grab touch-none select-none pt-2 active:cursor-grabbing"
            {...detents.handleProps}
          />
          {isOpen && (
            <CheckinForm
              key={state.formKey}
              cafeId={props.cafeId}
              cafeName={props.cafeName}
              mode={state.effectiveMode}
              editCheckinId={state.effectiveEditId}
              initialScores={props.initialScores ?? state.revisit?.scores}
              initialMaxStay={props.initialMaxStay ?? state.revisit?.max_stay ?? null}
              initialNote={props.initialNote ?? state.revisit?.note ?? null}
              initialPhotos={props.initialPhotos}
              promptCaption={props.promptCaption}
              isAuthenticated={props.isAuthenticated}
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

export function CheckinDrawer(props: CheckinDrawerProps) {
  const { isOpen, onOpenChange, cafeId, mode = "create", editCheckinId, isAuthenticated } = props;
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

  const detents = useDrawerDetents({
    isOpen,
    onRequestClose: () => handleCloseAttempt(false),
  });

  return (
    <CheckinDrawerSurface
      props={props}
      state={state}
      detents={detents}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      handleCloseAttempt={handleCloseAttempt}
    />
  );
}
