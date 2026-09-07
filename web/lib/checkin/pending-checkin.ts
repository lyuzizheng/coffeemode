import { get, set, del, createStore } from "idb-keyval";
import type { CheckInScores, MaxStay } from "@/types/checkins";

/**
 * Pending check-in draft for the sign-in gate (DG66/DG59).
 *
 * A logged-out composer finishes all input, taps Check in, and the whole
 * draft — scores, max stay, note, and the staged photo Files (IndexedDB's
 * structured clone preserves Blob/File) — is persisted locally before the
 * full-page OAuth bounce. After the callback returns with
 * `?checkin_resume=1`, CheckinResume reloads this draft, reopens the drawer
 * with every input restored, and the photos upload only then (presigned
 * URLs are issued to authenticated sessions only, §3.5).
 *
 * Scope is deliberately narrow: this is the gate's pending-publish draft
 * only, not the general close-the-drawer persistence DG21 parked for V2.
 * A newer gate draft overwrites the older one — one pending check-in at a
 * time.
 */

export interface PendingCheckinPhoto {
  id: string;
  file: File;
  /** Present when the photo already uploaded before the bounce (e.g. the auth probe raced the session expiring). */
  imageUuid?: string;
}

export interface PendingCheckinDraft {
  cafeId: string;
  cafeName: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  note: string;
  photos: PendingCheckinPhoto[];
  createdAt: number;
}

const draftStore = createStore("coffeemode-pending-checkin", "draft");
const DRAFT_KEY = "pending";

export async function savePendingCheckin(draft: PendingCheckinDraft): Promise<void> {
  await set(DRAFT_KEY, draft, draftStore);
}

/**
 * Loads the pending draft, or null when none exists or it has outlived
 * `ttlMs` (checkins.pendingDraftTtlHours, DG107). An expired draft is
 * cleared eagerly so the store never grows stale entries.
 */
export async function loadPendingCheckin(ttlMs: number): Promise<PendingCheckinDraft | null> {
  const draft = await get<PendingCheckinDraft>(DRAFT_KEY, draftStore);
  if (!draft) return null;
  if (Date.now() - draft.createdAt > ttlMs) {
    await del(DRAFT_KEY, draftStore);
    return null;
  }
  return draft;
}

export async function clearPendingCheckin(): Promise<void> {
  await del(DRAFT_KEY, draftStore);
}
