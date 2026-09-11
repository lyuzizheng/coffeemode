"use client";

import type { QueryClient } from "@tanstack/react-query";
import { responseMessage } from "@/lib/http";
import type { CheckInScores, MaxStay } from "@/types/checkins";

export function invalidateCheckinQueries(queryClient: QueryClient, cafeId: string) {
  queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["last-checkin", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["profile"] });
}

export async function updateCheckin({
  editCheckinId,
  scores,
  maxStay,
  note,
  fallbackErrorMessage,
}: {
  editCheckinId: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  fallbackErrorMessage: string;
}) {
  const body: Record<string, unknown> = {
    scores,
    max_stay: maxStay,
    note: note.trim() ? note.trim() : null,
  };
  const res = await fetch(`/api/checkins/${editCheckinId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(await responseMessage(res, fallbackErrorMessage));
  return res.json();
}

async function handleConflictRevisit({
  res,
  scores,
  maxStay,
  note,
  fallbackErrorMessage,
}: {
  res: Response;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  fallbackErrorMessage: string;
}) {
  const conflict = (await res.json().catch(() => null)) as {
    existing_checkin_id?: unknown;
  } | null;
  const existingId = conflict?.existing_checkin_id;
  if (typeof existingId === "string" && existingId.length > 0) {
    return updateCheckin({
      editCheckinId: existingId,
      scores,
      maxStay,
      note,
      fallbackErrorMessage,
    });
  }
  throw new Error(await responseMessage(res, fallbackErrorMessage));
}

export async function createCheckin({
  cafeId,
  idempotencyKey,
  scores,
  maxStay,
  note,
  uploadedIds,
  fallbackErrorMessage,
}: {
  cafeId: string;
  idempotencyKey: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  uploadedIds: string[];
  fallbackErrorMessage: string;
}) {
  const body: Record<string, unknown> = {
    cafe_id: cafeId,
    idempotency_key: idempotencyKey,
    scores,
    ...(maxStay ? { max_stay: maxStay } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(uploadedIds.length > 0 ? { photo_ids: uploadedIds } : {}),
  };
  const res = await fetch("/api/checkins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 409) {
    return handleConflictRevisit({ res, scores, maxStay, note, fallbackErrorMessage });
  }
  if (!res.ok) throw new Error(await responseMessage(res, fallbackErrorMessage));
  return res.json();
}

export async function deleteCheckin({
  editCheckinId,
  fallbackErrorMessage,
}: {
  editCheckinId: string;
  fallbackErrorMessage: string;
}) {
  const res = await fetch(`/api/checkins/${editCheckinId}`, { method: "DELETE" });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(await responseMessage(res, fallbackErrorMessage));
  return res.json();
}
