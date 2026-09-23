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
  /** Photos already attached to the check-in being edited (BRAWUKA-563) —
   *  seeded into the picker as done tiles; the submit diffs them against
   *  the surviving tiles to build add/remove_photo_ids. */
  existingPhotos?: { id: string; thumbnail: string }[];
  /** DG92: navigation-prompt-only caption under the cafe name (default off). */
  promptCaption?: boolean;
  isAuthenticated?: boolean;
  lastCheckin?: LastCheckin | null;
  authProbeFailed?: boolean;
  lastCheckinLoaded?: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

function useCheckinLifecycle({
  options,
  scoresState,
  maxStay,
  setMaxStay,
  note,
  setNote,
  photos,
  photosDirty,
  showSignInGate,
}: {
  options: UseCheckinFormStateOptions;
  scoresState: CheckinScoresState;
  maxStay: MaxStay | null;
  setMaxStay: (val: MaxStay | null) => void;
  note: string;
  setNote: (val: string) => void;
  photos: PhotoUpload[];
  photosDirty: boolean;
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
    photosDirty,
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

  // Edit-mode dirty check (BRAWUKA-563): a photo change is any tile whose id
  // is not an existing image id (added) or any existing id whose tile is
  // gone (removed). Create keeps the old "any staged photo" rule.
  const existingIds = useMemo(
    () => new Set((options.existingPhotos ?? []).map((p) => p.id)),
    [options.existingPhotos],
  );
  const photosDirty = isEdit
    ? photos.some((p) => !existingIds.has(p.id)) ||
      (options.existingPhotos ?? []).some((p) => !photos.some((t) => t.id === p.id))
    : photos.length > 0;

  const repeat = useCheckinLifecycle({
    options,
    scoresState,
    maxStay,
    setMaxStay,
    note,
    setNote,
    photos,
    photosDirty,
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
