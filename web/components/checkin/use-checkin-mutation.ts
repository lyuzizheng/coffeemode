"use client";

import { useState } from "react";
import { toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearPendingCheckin } from "@/lib/checkin/pending-checkin";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import {
  createCheckin,
  updateCheckin,
  deleteCheckin,
  invalidateCheckinQueries,
} from "./checkin-api";

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
  onClose: () => void;
  onRequireSignIn: () => void;
}

function resolveSubmitError(
  err: unknown,
  t: (key: "photosUploading" | "photosFailed" | "couldntSave") => string,
): string {
  if (err instanceof Error && err.message === "photos_uploading") {
    return t("photosUploading");
  }
  if (err instanceof Error && err.message === "photo_upload_failed") {
    return t("photosFailed");
  }
  return err instanceof Error ? err.message : t("couldntSave");
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

  return useMutation({
    mutationFn: async (params: SubmitCheckinParams) => {
      const uploadedIds = await uploadPendingPhotos();
      if (isEdit && editCheckinId) {
        return updateCheckin({
          editCheckinId,
          scores: params.scores,
          maxStay: params.maxStay,
          note: params.note,
          fallbackErrorMessage: t("couldntSave"),
        });
      }
      return createCheckin({
        cafeId,
        idempotencyKey,
        scores: params.scores,
        maxStay: params.maxStay,
        note: params.note,
        uploadedIds,
        fallbackErrorMessage: t("couldntSave"),
      });
    },
    onMutate: () => {
      setView("submitting");
      setError(null);
      setFailedAction(null);
    },
    onSuccess: () => {
      setView("success");
      // Benign: clearing consumed draft from IndexedDB is best-effort; failures in private mode are ignored.
      void clearPendingCheckin().catch(() => {});
      invalidateCheckinQueries(queryClient, cafeId);
      setTimeout(() => {
        onClose();
        toast(t("saved"), { timeout: 3000 });
      }, 1200);
    },
    onError: (err) => {
      setView("form");
      if (err instanceof Error && err.message === "unauthorized") {
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
      return deleteCheckin({
        editCheckinId,
        fallbackErrorMessage: t("couldntSave"),
      });
    },
    onSuccess: () => {
      invalidateCheckinQueries(queryClient, cafeId);
      onClose();
      toast(t("deleted"), { timeout: 3000 });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "unauthorized") {
        onRequireSignIn();
        return;
      }
      setFailedAction("delete");
      setError(err instanceof Error ? err.message : t("couldntSave"));
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
