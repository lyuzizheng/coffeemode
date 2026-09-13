"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useStagedPhotos } from "./use-staged-photos";
import { useCheckinMutation } from "./use-checkin-mutation";
import type { CheckinScoresState } from "./use-checkin-scores";
import type { UseCheckinFormStateOptions } from "./use-checkin-form-state";
import type { CheckInScores, MaxStay } from "@/types/checkins";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const nibble = () => Math.floor(Math.random() * 16).toString(16);
  const hex = (n: number) => Array.from({ length: n }, nibble).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((parseInt(nibble(), 16) & 0x3) | 0x8).toString(16)}${hex(3)}-${hex(12)}`;
}

function executeSubmit({
  isOffline,
  overall,
  effectivelyAuthenticated,
  setError,
  setShowSignInGate,
  submit,
  scores,
  maxStay,
  note,
  offlineMessage,
}: {
  isOffline: boolean;
  overall: number | null;
  effectivelyAuthenticated: boolean;
  setError: (err: string) => void;
  setShowSignInGate: (show: boolean) => void;
  submit: (p: { scores: CheckInScores; maxStay: MaxStay | null; note: string }) => void;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  offlineMessage: string;
}) {
  if (isOffline) {
    setError(offlineMessage);
  } else if (overall !== null) {
    if (!effectivelyAuthenticated) {
      setShowSignInGate(true);
    } else {
      submit({ scores, maxStay, note });
    }
  }
}

/**
 * Submit/delete wiring plus the sign-in gate it feeds: every 401 path in the
 * drawer (submit, delete, immediate photo upload) converges on `requireSignIn`,
 * because the gate is the only recovery a dead session has (BRAWUKA-212).
 */
export function useCheckinSubmit({
  options,
  scoresState,
  maxStay,
  note,
  isOffline,
  effectivelyAuthenticated,
}: {
  options: UseCheckinFormStateOptions;
  scoresState: CheckinScoresState;
  maxStay: MaxStay | null;
  note: string;
  isOffline: boolean;
  effectivelyAuthenticated: boolean;
}) {
  const t = useTranslations("checkIn");
  const [showSignInGate, setShowSignInGate] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const { photos, setPhotos, uploadPendingPhotos } = useStagedPhotos(options.initialPhotos);
  const requireSignIn = useCallback(() => setShowSignInGate(true), []);

  const mutation = useCheckinMutation({
    cafeId: options.cafeId,
    isEdit: options.mode === "edit",
    editCheckinId: options.editCheckinId,
    idempotencyKey,
    uploadPendingPhotos,
    onClose: options.onClose,
    onRequireSignIn: requireSignIn,
  });

  const handleSubmit = () =>
    executeSubmit({
      isOffline,
      overall: scoresState.overall,
      effectivelyAuthenticated,
      setError: mutation.setError,
      setShowSignInGate,
      submit: mutation.submit,
      scores: scoresState.scores,
      maxStay,
      note,
      offlineMessage: t("offline"),
    });

  // Retry re-reads live form state (pre-split: `mutate()` with no vars), so
  // edits made after a failure are not silently dropped.
  const handleRetry = () =>
    mutation.failedAction === "delete" ? mutation.deleteCheckin() : handleSubmit();

  return { photos, setPhotos, showSignInGate, requireSignIn, mutation, handleSubmit, handleRetry };
}
