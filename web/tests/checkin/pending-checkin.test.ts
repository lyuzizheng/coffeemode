import { describe, expect, it, beforeEach, vi } from "vitest";
import { get, set } from "idb-keyval";
import {
  savePendingCheckin,
  loadPendingCheckin,
  clearPendingCheckin,
  draftStore,
  DRAFT_KEY,
  isPendingCheckinDraft,
  type PendingCheckinDraft,
} from "@/lib/checkin/pending-checkin";
import * as idbKeyval from "idb-keyval";

describe("pending-checkin persistence (real IndexedDB)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearPendingCheckin();
  });

  const validDraft: PendingCheckinDraft = {
    cafeId: "cafe-123",
    cafeName: "Test Cafe",
    scores: { wifi: 80, seats: 70, overall: 85 },
    maxStay: "2h",
    note: "Quiet spot with great coffee",
    photos: [
      {
        id: "p-1",
        name: "photo1.jpg",
        file: new File(["image-content"], "photo1.jpg", { type: "image/jpeg" }),
        imageUuid: "img-uuid-1",
      },
    ],
    createdAt: Date.now(),
  };

  it("persists and restores a full draft with files via IndexedDB", async () => {
    await savePendingCheckin(validDraft);

    const loaded = await loadPendingCheckin(60_000);
    expect(loaded).not.toBeNull();
    expect(loaded?.cafeId).toBe("cafe-123");
    expect(loaded?.cafeName).toBe("Test Cafe");
    expect(loaded?.scores).toEqual({ wifi: 80, seats: 70, overall: 85 });
    expect(loaded?.maxStay).toBe("2h");
    expect(loaded?.note).toBe("Quiet spot with great coffee");
    expect(loaded?.photos).toHaveLength(1);
    expect(loaded?.photos[0].id).toBe("p-1");
    expect(loaded?.photos[0].imageUuid).toBe("img-uuid-1");
    expect(loaded?.photos[0].file).toBeInstanceOf(Blob);
    expect(loaded?.photos[0].name).toBe("photo1.jpg");
  });

  it("overwrites an older draft when a newer one is saved (single active draft)", async () => {
    await savePendingCheckin(validDraft);

    const newerDraft: PendingCheckinDraft = {
      ...validDraft,
      cafeId: "cafe-456",
      cafeName: "Second Cafe",
      note: "Updated draft note",
      createdAt: Date.now() + 100,
    };
    await savePendingCheckin(newerDraft);

    const loaded = await loadPendingCheckin(60_000);
    expect(loaded).not.toBeNull();
    expect(loaded?.cafeId).toBe("cafe-456");
    expect(loaded?.cafeName).toBe("Second Cafe");
    expect(loaded?.note).toBe("Updated draft note");
  });

  it("clears the draft when clearPendingCheckin is called", async () => {
    await savePendingCheckin(validDraft);
    expect(await loadPendingCheckin(60_000)).not.toBeNull();

    await clearPendingCheckin();

    const loaded = await loadPendingCheckin(60_000);
    expect(loaded).toBeNull();

    // Verify low-level key in draftStore is also removed
    const raw = await get(DRAFT_KEY, draftStore);
    expect(raw).toBeUndefined();
  });

  it("does not throw when clearPendingCheckin is called on an empty store", async () => {
    await expect(clearPendingCheckin()).resolves.toBeUndefined();
  });

  describe("TTL expiration", () => {
    it("returns the draft if within TTL", async () => {
      const draft: PendingCheckinDraft = {
        ...validDraft,
        createdAt: Date.now() - 5_000,
      };
      await savePendingCheckin(draft);

      const loaded = await loadPendingCheckin(10_000);
      expect(loaded).not.toBeNull();
      expect(loaded?.cafeId).toBe("cafe-123");
    });

    it("returns null and eagerly deletes the draft when outliving TTL", async () => {
      const draft: PendingCheckinDraft = {
        ...validDraft,
        createdAt: Date.now() - 15_000,
      };
      await savePendingCheckin(draft);

      // TTL is 10s, draft is 15s old
      const loaded = await loadPendingCheckin(10_000);
      expect(loaded).toBeNull();

      // Ensure it was eagerly deleted from IndexedDB
      const raw = await get(DRAFT_KEY, draftStore);
      expect(raw).toBeUndefined();
    });

    it("eagerly clears draft when ttlMs is 0 or negative", async () => {
      await savePendingCheckin(validDraft);

      expect(await loadPendingCheckin(0)).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();

      await savePendingCheckin(validDraft);
      expect(await loadPendingCheckin(-1000)).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });
  });

  describe("corrupted data and parse failure handling", () => {
    it("handles non-object primitive in storage gracefully by clearing and returning null", async () => {
      await set(DRAFT_KEY, "corrupt-string-data", draftStore);

      const loaded = await loadPendingCheckin(60_000);
      expect(loaded).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });

    it("handles draft with missing createdAt by clearing and returning null", async () => {
      const corrupt = {
        cafeId: "cafe-123",
        cafeName: "Test",
        note: "no createdAt",
        scores: {},
        photos: [],
      };
      await set(DRAFT_KEY, corrupt, draftStore);

      const loaded = await loadPendingCheckin(60_000);
      expect(loaded).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });

    it("handles draft with invalid NaN or non-finite createdAt", async () => {
      const corrupt = {
        ...validDraft,
        createdAt: Number.NaN,
      };
      await set(DRAFT_KEY, corrupt, draftStore);

      const loaded = await loadPendingCheckin(60_000);
      expect(loaded).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });

    it("handles draft with missing or non-array photos", async () => {
      const corrupt = {
        ...validDraft,
        photos: "not-an-array",
      };
      await set(DRAFT_KEY, corrupt, draftStore);

      const loaded = await loadPendingCheckin(60_000);
      expect(loaded).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });

    it("handles draft with corrupt photo entry (file is not a Blob/File)", async () => {
      const corrupt = {
        ...validDraft,
        photos: [{ id: "p1", file: "not-a-file" }],
      };
      await set(DRAFT_KEY, corrupt, draftStore);

      const loaded = await loadPendingCheckin(60_000);
      expect(loaded).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });

    it("handles draft with missing cafeId or scores", async () => {
      await set(DRAFT_KEY, { ...validDraft, cafeId: "" }, draftStore);
      expect(await loadPendingCheckin(60_000)).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();

      await set(DRAFT_KEY, { ...validDraft, scores: null }, draftStore);
      expect(await loadPendingCheckin(60_000)).toBeNull();
      expect(await get(DRAFT_KEY, draftStore)).toBeUndefined();
    });

    it("catches database read failure from store and returns null instead of throwing", async () => {
      const failingStore: idbKeyval.UseStore = async () => {
        throw new DOMException("Corrupt database record", "DataError");
      };

      const loaded = await loadPendingCheckin(60_000, failingStore);
      expect(loaded).toBeNull();
    });
  });

  describe("QuotaExceeded handling and save validation", () => {
    it("propagates QuotaExceededError when IndexedDB quota is exceeded", async () => {
      const quotaStore: idbKeyval.UseStore = async () => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      };

      await expect(savePendingCheckin(validDraft, quotaStore)).rejects.toThrowError(
        /quota/i,
      );
    });

    it("throws TypeError when attempting to save an invalid draft", async () => {
      const invalid = { cafeId: "" } as unknown as PendingCheckinDraft;
      await expect(savePendingCheckin(invalid)).rejects.toThrow(TypeError);
    });
  });

  describe("isPendingCheckinDraft type guard", () => {
    it("validates correct draft structures", () => {
      expect(isPendingCheckinDraft(validDraft)).toBe(true);
    });

    it("rejects non-objects, null, or undefined", () => {
      expect(isPendingCheckinDraft(null)).toBe(false);
      expect(isPendingCheckinDraft(undefined)).toBe(false);
      expect(isPendingCheckinDraft("draft")).toBe(false);
      expect(isPendingCheckinDraft(42)).toBe(false);
    });

    it("rejects missing required fields", () => {
      expect(isPendingCheckinDraft({ ...validDraft, cafeId: "" })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, photos: [null] })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, photos: [{ id: "", name: "f.jpg", file: new File([], "f.jpg") }] })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, photos: [{ id: "p1", name: "", file: new File([], "f.jpg") }] })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, photos: [{ id: "p1", file: new File([], "f.jpg") }] })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, photos: [{ id: "p1", name: "f.jpg", file: new File([], "f.jpg"), imageUuid: 123 }] })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, cafeName: 123 })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, note: null })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, createdAt: -5 })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, scores: [] })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, photos: null })).toBe(false);
      expect(isPendingCheckinDraft({ ...validDraft, maxStay: 123 })).toBe(false);
    });
  });
});
