"use client";

import type { QueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/http";
import type { CheckInScores, MaxStay } from "@/types/checkins";

export function invalidateCheckinQueries(queryClient: QueryClient, cafeId: string) {
  queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["last-checkin", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["profile"] });
  // The discovery list renders work_stats.composite_score on every card and
  // "cafes-list" is IndexedDB-persisted — without this the new check-in's
  // score stays stale across tab reopens (keys.ts: mutations invalidate
  // every affected key explicitly).
  queryClient.invalidateQueries({ queryKey: ["cafes-list"] });
}

export async function updateCheckin({
  editCheckinId,
  scores,
  maxStay,
  note,
  addPhotoIds,
  removePhotoIds,
}: {
  editCheckinId: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  /** Edit-mode photo deltas (BRAWUKA-563): fresh upload ids to attach,
   *  existing image ids to detach. */
  addPhotoIds?: string[];
  removePhotoIds?: string[];
}) {
  const body: Record<string, unknown> = {
    scores,
    max_stay: maxStay,
    note: note.trim() ? note.trim() : null,
    ...(addPhotoIds && addPhotoIds.length > 0 ? { add_photo_ids: addPhotoIds } : {}),
    ...(removePhotoIds && removePhotoIds.length > 0 ? { remove_photo_ids: removePhotoIds } : {}),
  };
  return apiFetch(`/api/checkins/${editCheckinId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function handleConflictRevisit({
  conflict,
  scores,
  maxStay,
  note,
  uploadedIds,
}: {
  conflict: ApiError;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  uploadedIds: string[];
}) {
  const existingId = conflict.details?.existing_checkin_id;
  if (typeof existingId === "string" && existingId.length > 0) {
    const checkin = await updateCheckin({
      editCheckinId: existingId,
      scores,
      maxStay,
      note,
      // PATCH accepts photo deltas (BRAWUKA-563): the staged uploads append
      // to the existing check-in instead of being dropped (BRAWUKA-126).
      addPhotoIds: uploadedIds,
    });
    return { checkin, convertedToEdit: true };
  }
  throw conflict;
}

export async function createCheckin({
  cafeId,
  idempotencyKey,
  scores,
  maxStay,
  note,
  uploadedIds,
}: {
  cafeId: string;
  idempotencyKey: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  uploadedIds: string[];
}) {
  const body: Record<string, unknown> = {
    cafe_id: cafeId,
    idempotency_key: idempotencyKey,
    scores,
    ...(maxStay ? { max_stay: maxStay } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(uploadedIds.length > 0 ? { photo_ids: uploadedIds } : {}),
  };
  try {
    const checkin = await apiFetch("/api/checkins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { checkin, convertedToEdit: false };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) {
      return handleConflictRevisit({ conflict: cause, scores, maxStay, note, uploadedIds });
    }
    throw cause;
  }
}

export async function deleteCheckin({ editCheckinId }: { editCheckinId: string }) {
  return apiFetch(`/api/checkins/${editCheckinId}`, { method: "DELETE" });
}
