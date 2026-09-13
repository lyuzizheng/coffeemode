"use client";

import { useCallback, useMemo, useState } from "react";
import { useCheckinScoresState, type CheckinScoresState } from "./use-checkin-scores";
import { useCheckinSubmit } from "./use-checkin-submit";
import { useCheckinDraft, useCheckinDirty } from "./use-checkin-draft";
import type { PhotoUpload } from "./checkin-photos";
import { useNetworkStatus } from "@/hooks/use-network-status";
import type { LastCheckin } from "@/lib/checkin/last-checkin";
import type { CheckInScores, MaxStay } from "@/types/checkins";

export const CHECKIN_RESUME_PARAM = "checkin_resume";
export type DrawerMode = "create" | "edit";

function isWithin90Days(iso: string): boolean {
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs < 90 * 24 * 60 * 60 * 1000;
}

function useRepeatVisitBanner({
  lastCheckin,
  isEdit,
  onApply,
}: {
  lastCheckin?: LastCheckin | null;
  isEdit: boolean;
  onApply: (checkin: LastCheckin) => void;
}) {
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const within90Days = useMemo(
    () => (lastCheckin ? isWithin90Days(lastCheckin.visited_at) : false),
    [lastCheckin],
  );

  const showRepeatBanner = !isEdit && within90Days && !repeatDismissed && Boolean(lastCheckin);

  const applySameAsLast = useCallback(() => {
    if (!lastCheckin) return;
    onApply(lastCheckin);
    setRepeatDismissed(true);
  }, [lastCheckin, onApply]);

  return {
    showRepeatBanner,
    applySameAsLast,
    dismissRepeat: () => setRepeatDismissed(true),
  };
}

export interface UseCheckinFormStateOptions {
  cafeId: string;
  cafeName: string;
  mode: DrawerMode;
  editCheckinId?: string;
  initialScores?: CheckInScores;
  initialMaxStay?: MaxStay | null;
  initialNote?: string | null;
  initialPhotos?: PhotoUpload[];
  isAuthenticated?: boolean;
  lastCheckin?: LastCheckin | null;
  authProbeFailed?: boolean;
  lastCheckinLoaded?: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /**
   * Reports the staged photo count synchronously from inside the photo
   * setter — the drawer's preempt check runs on render and cannot wait for
   * an effect to learn photos were just staged (BRAWUKA-126).
   */
  onStagedPhotosChange?: (count: number) => void;
}

function useCheckinLifecycle({
  options,
  scoresState,
  maxStay,
  setMaxStay,
  note,
  setNote,
  photos,
  showSignInGate,
}: {
  options: UseCheckinFormStateOptions;
  scoresState: CheckinScoresState;
  maxStay: MaxStay | null;
  setMaxStay: (val: MaxStay | null) => void;
  note: string;
  setNote: (val: string) => void;
  photos: PhotoUpload[];
  showSignInGate: boolean;
}) {
  const isEdit = options.mode === "edit";

  useCheckinDraft({
    cafeId: options.cafeId,
    cafeName: options.cafeName,
    isEdit,
    scores: scoresState.scores,
    maxStay,
    note,
    photos,
    showSignInGate,
  });

  useCheckinDirty({
    isEdit,
    scoresState,
    maxStay,
    note,
    photosLength: photos.length,
    initialScores: options.initialScores,
    initialMaxStay: options.initialMaxStay,
    initialNote: options.initialNote,
    onDirtyChange: options.onDirtyChange,
  });

  return useRepeatVisitBanner({
    lastCheckin: options.lastCheckin,
    isEdit,
    onApply: (checkin) => {
      scoresState.applyScores(checkin.scores);
      setMaxStay(checkin.max_stay ?? null);
      setNote(checkin.note ?? "");
    },
  });
}

export function useCheckinFormState(options: UseCheckinFormStateOptions) {
  const { state: networkState } = useNetworkStatus();
  const isOffline = networkState === "offline";
  const isEdit = options.mode === "edit";

  const scoresState = useCheckinScoresState(options.initialScores);
  const [maxStay, setMaxStay] = useState<MaxStay | null>(options.initialMaxStay ?? null);
  const [note, setNote] = useState(options.initialNote ?? "");

  const effectivelyAuthenticated = (options.isAuthenticated ?? true) && !options.authProbeFailed;
  const authConfirmed =
    options.isAuthenticated === true ||
    (options.isAuthenticated === undefined && options.lastCheckinLoaded);

  const submit = useCheckinSubmit({
    options,
    scoresState,
    maxStay,
    note,
    isOffline,
    effectivelyAuthenticated,
  });
  const { photos, showSignInGate } = submit;

  const repeat = useCheckinLifecycle({
    options,
    scoresState,
    maxStay,
    setMaxStay,
    note,
    setNote,
    photos,
    showSignInGate,
  });

  const canSubmit =
    scoresState.overall !== null && submit.mutation.view !== "submitting" && submit.mutation.view !== "success";

  return {
    isEdit,
    isOffline,
    deferUpload: !isEdit && !authConfirmed,
    scoresState,
    maxStay,
    setMaxStay,
    note,
    setNote,
    photos,
    setPhotos: submit.setPhotos,
    showSignInGate,
    requireSignIn: submit.requireSignIn,
    canSubmit,
    handleSubmit: submit.handleSubmit,
    handleRetry: submit.handleRetry,
    mutation: submit.mutation,
    repeat,
  };
}
