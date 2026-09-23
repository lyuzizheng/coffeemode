"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { PhotoUpload } from "./checkin-photos";
import type { CheckinScoresState } from "./use-checkin-scores";
import { savePendingCheckin } from "@/lib/checkin/pending-checkin";
import type { CheckInScores, MaxStay } from "@/types/checkins";

export function useCheckinDraft({
  cafeId,
  cafeName,
  isEdit,
  scores,
  maxStay,
  note,
  photos,
  showSignInGate,
}: {
  cafeId: string;
  cafeName: string;
  isEdit: boolean;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  photos: PhotoUpload[];
  showSignInGate: boolean;
}) {
  const stagePendingDraft = useCallback(() => {
    if (isEdit) return;
    void savePendingCheckin({
      cafeId,
      cafeName,
      scores,
      maxStay,
      note,
      photos: photos
        .filter((p): p is PhotoUpload & { file: File } => p.file !== undefined)
        .map((p) => ({
          id: p.id,
          name: p.file.name || "photo.jpg",
          file: p.file,
          ...(p.imageUuid ? { imageUuid: p.imageUuid } : {}),
        })),
      createdAt: Date.now(),
      // Benign: saving draft to IndexedDB is best-effort; quota or private mode failures must not break editing.
    }).catch(() => {});
  }, [isEdit, cafeId, cafeName, scores, maxStay, note, photos]);

  useEffect(() => {
    if (showSignInGate) stagePendingDraft();
  }, [showSignInGate, stagePendingDraft]);
}

function computeDirtyState({
  isEdit,
  scoresState,
  maxStay,
  note,
  photosDirty,
  initialScores,
  initialMaxStay,
  initialNote,
}: {
  isEdit: boolean;
  scoresState: CheckinScoresState;
  maxStay: MaxStay | null;
  note: string;
  /** Caller-computed: create = any staged photo; edit = the photo set
   *  differs from the check-in's attached photos (BRAWUKA-563). */
  photosDirty: boolean;
  initialScores?: CheckInScores;
  initialMaxStay?: MaxStay | null;
  initialNote?: string | null;
}): boolean {
  if (isEdit) {
    const base = initialScores ?? {};
    return (
      scoresState.wifi !== (base.wifi ?? null) ||
      scoresState.outlets !== (base.outlets ?? null) ||
      scoresState.seats !== (base.seats ?? null) ||
      scoresState.temp !== (base.temp ?? null) ||
      scoresState.coffee !== (base.coffee ?? null) ||
      scoresState.overall !== (base.overall ?? null) ||
      maxStay !== (initialMaxStay ?? null) ||
      note !== (initialNote ?? "") ||
      photosDirty
    );
  }
  return (
    scoresState.wifi !== null ||
    scoresState.outlets !== null ||
    scoresState.seats !== null ||
    scoresState.temp !== null ||
    scoresState.coffee !== null ||
    scoresState.overall !== null ||
    maxStay !== null ||
    note.trim() !== "" ||
    photosDirty
  );
}

export function useCheckinDirty({
  isEdit,
  scoresState,
  maxStay,
  note,
  photosDirty,
  initialScores,
  initialMaxStay,
  initialNote,
  onDirtyChange,
}: {
  isEdit: boolean;
  scoresState: CheckinScoresState;
  maxStay: MaxStay | null;
  note: string;
  photosDirty: boolean;
  initialScores?: CheckInScores;
  initialMaxStay?: MaxStay | null;
  initialNote?: string | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const isDirty = useMemo(
    () =>
      computeDirtyState({
        isEdit,
        scoresState,
        maxStay,
        note,
        photosDirty,
        initialScores,
        initialMaxStay,
        initialNote,
      }),
    [isEdit, scoresState, maxStay, note, photosDirty, initialScores, initialMaxStay, initialNote],
  );

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  return isDirty;
}
