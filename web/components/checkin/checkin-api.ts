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
}: {
  editCheckinId: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
}) {
  const body: Record<string, unknown> = {
    scores,
    max_stay: maxStay,
    note: note.trim() ? note.trim() : null,
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
}: {
  conflict: ApiError;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
}) {
  const existingId = conflict.details?.existing_checkin_id;
  if (typeof existingId === "string" && existingId.length > 0) {
    const checkin = await updateCheckin({
      editCheckinId: existingId,
      scores,
      maxStay,
      note,
    });
    // PATCH carries no photos (creation-time contract): photo_ids staged in
    // the POST body are dropped here, and the caller must say so
    // (BRAWUKA-126).
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
      return handleConflictRevisit({ conflict: cause, scores, maxStay, note });
    }
    throw cause;
  }
}

export async function deleteCheckin({ editCheckinId }: { editCheckinId: string }) {
  return apiFetch(`/api/checkins/${editCheckinId}`, { method: "DELETE" });
}
