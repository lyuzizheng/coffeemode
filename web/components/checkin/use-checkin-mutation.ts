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
  /** Photos staged in state at submit time — the PATCH contract cannot save
   *  them, so an edit save must report the drop instead of staying silent
   *  (BRAWUKA-395 P2-2). */
  photoCount: number;
}

interface UseCheckinMutationOptions {
  cafeId: string;
  isEdit: boolean;
  editCheckinId?: string;
  idempotencyKey: string;
  uploadPendingPhotos: () => Promise<string[]>;
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

function useSubmitMutation({
  cafeId,
  isEdit,
  editCheckinId,
  idempotencyKey,
  uploadPendingPhotos,
  onClose,
  onRequireSignIn,
  setView,
  setError,
  setFailedAction,
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
    mutationFn: async (params: SubmitCheckinParams) => {
      // Edit PATCHes carry no photo_ids — staged photos drop here, so the save
      // must say so (BRAWUKA-395 P2-2); uploading would only orphan R2 objects (BRAWUKA-269).
      if (isEdit && editCheckinId) {
        await updateCheckin({
          editCheckinId,
          scores: params.scores,
          maxStay: params.maxStay,
          note: params.note,
        });
        return { photosDropped: params.photoCount > 0 };
      }
      const uploadedIds = await uploadPendingPhotos();
      const { convertedToEdit } = await createCheckin({
        cafeId,
        idempotencyKey,
        scores: params.scores,
        maxStay: params.maxStay,
        note: params.note,
        uploadedIds,
      });
      // A raced 409 silently converts to PATCH, which carries no photos — the uploaded ids are orphaned and the user must be told (BRAWUKA-126).
      return { photosDropped: convertedToEdit && uploadedIds.length > 0 };
    },
    onMutate: () => {
      setView("submitting");
      setError(null);
      setFailedAction(null);
    },
    onSuccess: ({ photosDropped }) => {
      setView("success");
      // Benign: clearing consumed draft from IndexedDB is best-effort; failures in private mode are ignored.
      void clearPendingCheckin().catch(() => {});
      invalidateCheckinQueries(queryClient, cafeId);
      // Artifact §4 step 3: the success card holds 900ms, then the drawer closes and the toast confirms.
      closeTimerRef.current = window.setTimeout(() => {
        onClose();
        toast(photosDropped ? t("savedWithoutPhotos") : t("saved"), { timeout: SUCCESS_TOAST_TIMEOUT_MS });
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
