"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, isUnauthorized } from "@/lib/http";
import { clearPendingCheckin } from "@/lib/checkin/pending-checkin";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import {
  createCheckin,
  updateCheckin,
  deleteCheckin,
  invalidateCheckinQueries,
} from "./checkin-api";

/**
 * Post-save success UX (BRAWUKA-250). Interaction-design timings, not product
 * knobs: they change with UX review, so they stay named constants here rather
 * than `app.yaml` + env plumbing.
 */
const SUCCESS_CLOSE_DELAY_MS = 900;
const SUCCESS_TOAST_TIMEOUT_MS = 3000;

export type ViewState = "form" | "success" | "submitting";

interface SubmitCheckinParams {
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
}

interface UseCheckinMutationOptions {
  cafeId: string;
  isEdit: boolean;
  editCheckinId?: string;
  idempotencyKey: string;
  uploadPendingPhotos: () => Promise<string[]>;
  /** Image ids already attached to the check-in being edited — the submit
   *  diffs them against the surviving tiles to build remove_photo_ids
   *  (BRAWUKA-563). */
  existingPhotoIds?: string[];
  onClose: () => void;
  onRequireSignIn: () => void;
}

function resolveSubmitError(
  err: unknown,
  t: (key: "photosUploading" | "photosFailed" | "photoTooLarge" | "photoInvalid" | "couldntSave") => string,
): string {
  if (!(err instanceof Error)) return t("couldntSave");
  if (err.message === "photos_uploading") return t("photosUploading");
  if (err.message === "photo_upload_failed") return t("photosFailed");
  if (err.message === "photo_too_large") return t("photoTooLarge");
  if (err.message === "photo_invalid") return t("photoInvalid");
  // ApiError and anything else: mapped catalog copy or the localized
  // fallback — never server prose (spec 0011 D9).
  return apiErrorMessage(err, t("couldntSave"));
}

/**
 * The save call itself (BRAWUKA-563): uploads run first so a failed save
 * keeps the ids in state for retry instead of orphaning a second batch
 * (BRAWUKA-269). Edit PATCHes add/remove deltas; create POSTs photo_ids —
 * a raced 409 converts to PATCH and appends via add_photo_ids, so nothing
 * is dropped (BRAWUKA-126).
 */
async function submitCheckin(
  params: SubmitCheckinParams,
  options: Pick<
    UseCheckinMutationOptions,
    "cafeId" | "isEdit" | "editCheckinId" | "idempotencyKey" | "uploadPendingPhotos" | "existingPhotoIds"
  >,
): Promise<void> {
  const uploadedIds = await options.uploadPendingPhotos();
  if (options.isEdit && options.editCheckinId) {
    const surviving = new Set(uploadedIds);
    const existing = options.existingPhotoIds ?? [];
    await updateCheckin({
      editCheckinId: options.editCheckinId,
      scores: params.scores,
      maxStay: params.maxStay,
      note: params.note,
      // Delta contract: adds are ids not already attached; removes are
      // attached ids whose tile is gone.
      addPhotoIds: uploadedIds.filter((id) => !existing.includes(id)),
      removePhotoIds: existing.filter((id) => !surviving.has(id)),
    });
    return;
  }
  await createCheckin({
    cafeId: options.cafeId,
    idempotencyKey: options.idempotencyKey,
    scores: params.scores,
    maxStay: params.maxStay,
    note: params.note,
    uploadedIds,
  });
}

function useSubmitMutation({
  onClose,
  onRequireSignIn,
  setView,
  setError,
  setFailedAction,
  ...options
}: UseCheckinMutationOptions & {
  setView: (v: ViewState) => void;
  setError: (e: string | null) => void;
  setFailedAction: (a: "save" | "delete" | null) => void;
}) {
  const t = useTranslations("checkIn");
  const queryClient = useQueryClient();
  const closeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(closeTimerRef.current);
    };
  }, []);

  return useMutation({
    mutationFn: (params: SubmitCheckinParams) => submitCheckin(params, options),
    onMutate: () => {
      setView("submitting");
      setError(null);
      setFailedAction(null);
    },
    onSuccess: () => {
      setView("success");
      // Benign: clearing consumed draft from IndexedDB is best-effort; failures in private mode are ignored.
      void clearPendingCheckin().catch(() => {});
      invalidateCheckinQueries(queryClient, options.cafeId);
      // Artifact §4 step 3: the success card holds 900ms, then the drawer closes and the toast confirms.
      closeTimerRef.current = window.setTimeout(() => {
        onClose();
        toast(t("saved"), { timeout: SUCCESS_TOAST_TIMEOUT_MS });
      }, SUCCESS_CLOSE_DELAY_MS);
    },
    onError: (err) => {
      setView("form");
      if (isUnauthorized(err)) {
        onRequireSignIn();
        return;
      }
      setFailedAction("save");
      setError(resolveSubmitError(err, t));
    },
  });
}

function useDeleteMutation({
  cafeId,
  editCheckinId,
  onClose,
  onRequireSignIn,
  setError,
  setFailedAction,
}: {
  cafeId: string;
  editCheckinId?: string;
  onClose: () => void;
  onRequireSignIn: () => void;
  setError: (e: string | null) => void;
  setFailedAction: (a: "save" | "delete" | null) => void;
}) {
  const t = useTranslations("checkIn");
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!editCheckinId) throw new Error("missing id");
      return deleteCheckin({ editCheckinId });
    },
    onSuccess: () => {
      invalidateCheckinQueries(queryClient, cafeId);
      onClose();
      toast(t("deleted"), { timeout: 3000 });
    },
    onError: (err) => {
      if (isUnauthorized(err)) {
        onRequireSignIn();
        return;
      }
      setFailedAction("delete");
      setError(apiErrorMessage(err, t("couldntSave")));
    },
  });
}

export function useCheckinMutation(options: UseCheckinMutationOptions) {
  const [view, setView] = useState<ViewState>("form");
  const [error, setError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<"save" | "delete" | null>(null);

  const submitMutation = useSubmitMutation({
    ...options,
    setView,
    setError,
    setFailedAction,
  });

  const deleteMutation = useDeleteMutation({
    cafeId: options.cafeId,
    editCheckinId: options.editCheckinId,
    onClose: options.onClose,
    onRequireSignIn: options.onRequireSignIn,
    setError,
    setFailedAction,
  });

  return {
    view,
    error,
    setError,
    failedAction,
    submit: submitMutation.mutate,
    deleteCheckin: deleteMutation.mutate,
  };
}
