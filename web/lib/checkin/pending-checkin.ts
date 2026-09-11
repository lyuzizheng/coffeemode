import { get, set, del, createStore, type UseStore } from "idb-keyval";
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

interface PendingCheckinPhoto {
  id: string;
  name: string;
  file: File | Blob;
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

const DRAFT_STORE_NAME = "coffeemode-pending-checkin";
const DRAFT_OBJECT_STORE = "draft";
export const DRAFT_KEY = "pending";

export const draftStore = createStore(DRAFT_STORE_NAME, DRAFT_OBJECT_STORE);

export function isPendingCheckinDraft(val: unknown): val is PendingCheckinDraft {
  if (typeof val !== "object" || val === null) return false;
  const d = val as Record<string, unknown>;
  if (typeof d.cafeId !== "string" || !d.cafeId) return false;
  if (typeof d.cafeName !== "string") return false;
  if (typeof d.note !== "string") return false;
  if (typeof d.createdAt !== "number" || !Number.isFinite(d.createdAt) || d.createdAt <= 0) return false;
  if (typeof d.scores !== "object" || d.scores === null || Array.isArray(d.scores)) return false;
  if (d.maxStay !== null && d.maxStay !== undefined && typeof d.maxStay !== "string") return false;
  if (!Array.isArray(d.photos)) return false;
  for (const photo of d.photos) {
    if (typeof photo !== "object" || photo === null) return false;
    const record = photo as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) return false;
    if (typeof record.name !== "string" || !record.name) return false;
    const file = record.file;
    if (typeof file !== "object" || file === null) return false;
    const isBlobLike =
      file instanceof Blob ||
      "name" in file ||
      "size" in file;
    if (!isBlobLike) return false;
    if (record.imageUuid !== undefined && typeof record.imageUuid !== "string") return false;
  }
  return true;
}

export async function savePendingCheckin(
  draft: PendingCheckinDraft,
  store: UseStore = draftStore,
): Promise<void> {
  if (!isPendingCheckinDraft(draft)) {
    throw new TypeError("Invalid pending check-in draft");
  }
  await set(DRAFT_KEY, draft, store);
}

/**
 * Loads the pending draft, or null when none exists, it has outlived
 * `ttlMs` (checkins.pendingDraftTtlHours, DG107), or the stored data
 * is corrupted/unreadable. An expired or corrupted draft is cleared
 * eagerly so the store never grows stale or broken entries.
 */
export async function loadPendingCheckin(
  ttlMs: number,
  store: UseStore = draftStore,
): Promise<PendingCheckinDraft | null> {
  let draft: unknown;
  try {
    draft = await get<unknown>(DRAFT_KEY, store);
  } catch {
    // IndexedDB read error / deserialization failure: clear corrupt state eagerly
    try {
      await del(DRAFT_KEY, store);
    } catch {
      // Benign: best-effort cleanup of corrupt draft; IndexedDB deletion failure in private mode is ignored.
    }
    return null;
  }

  if (!draft) return null;

  if (!isPendingCheckinDraft(draft)) {
    try {
      await del(DRAFT_KEY, store);
    } catch {
      // Benign: best-effort cleanup of invalid draft; IndexedDB deletion failure in private mode is ignored.
    }
    return null;
  }

  if (Date.now() - draft.createdAt > ttlMs) {
    try {
      await del(DRAFT_KEY, store);
    } catch {
      // Benign: best-effort cleanup of expired draft; IndexedDB deletion failure in private mode is ignored.
    }
    return null;
  }

  return draft;
}

export async function clearPendingCheckin(store: UseStore = draftStore): Promise<void> {
  await del(DRAFT_KEY, store);
}
