import { describe, expect, it, vi } from "vitest";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
  type CompleteQueryFn,
  type CompleteUploadDeps,
} from "@/lib/images/complete";
import type { CompleteImageRequest, StoredImage } from "@/types/images";
import type { QueryResult } from "pg";

const CAFE_ID = "11111111-1111-4111-9111-111111111111";
const CHECKIN_ID = "22222222-2222-4222-a222-222222222222";
const IMAGE_UUID = "33333333-3333-4333-a333-333333333333";

const REQ: CompleteImageRequest = {
  imageUuid: IMAGE_UUID,
  targetType: "checkin",
  targetId: CHECKIN_ID,
};

const PROCESS_URLS = {
  imageUuid: IMAGE_UUID,
  original: { url: "https://r2.example.com/orig-signed", headers: {} },
  originalPut: { url: "https://r2.example.com/orig-put", headers: {} },
  card: { url: "https://r2.example.com/card-signed", headers: {} },
  thumbnail: { url: "https://r2.example.com/thumb-signed", headers: {} },
  publicUrls: {
    original: "https://pub.example.com/original/img.webp",
    card: "https://pub.example.com/card/img.webp",
    thumbnail: "https://pub.example.com/thumb/img.webp",
  },
  keys: {
    original: "original/img.webp",
    card: "card/img.webp",
    thumbnail: "thumb/img.webp",
  },
};

const PROCESSED = {
  imageUuid: IMAGE_UUID,
  publicUrls: PROCESS_URLS.publicUrls,
  width: 1200,
  height: 800,
};

function makeDeps(overrides: Partial<CompleteUploadDeps> = {}): {
  deps: CompleteUploadDeps;
  query: ReturnType<typeof vi.fn>;
  calls: { sql: string; params: unknown[] }[];
  txQueries: string[][];
} {
  const calls: { sql: string; params: unknown[] }[] = [];
  const queryFn = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    if (sql.includes("from cafes where id = $1 and created_by")) {
      return { rows: [{ id: CAFE_ID }], rowCount: 1 } as unknown as QueryResult<{ id: string }>;
    }
    if (sql.includes("from checkins where id = $1 and user_id")) {
      return { rows: [{ cafe_id: CAFE_ID }], rowCount: 1 } as unknown as QueryResult<{
        cafe_id: string | null;
      }>;
    }
    if (sql.includes("update checkins")) {
      return { rows: [{ id: CHECKIN_ID, cafe_id: CAFE_ID }], rowCount: 1 } as unknown as QueryResult<{
        id: string;
        cafe_id: string | null;
      }>;
    }
    if (sql.includes("update cafes")) {
      return { rows: [{ id: CAFE_ID }], rowCount: 1 } as unknown as QueryResult<{ id: string }>;
    }
    return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>;
  });
  const query = queryFn as unknown as CompleteQueryFn;

  const txQueries: string[][] = [];
  const runInTransaction = vi.fn(async (fn: Parameters<CompleteUploadDeps["runInTransaction"]>[0]) => {
    const collected: string[] = [];
    const txQuery = (async (sql: string, params?: unknown[]) => {
      collected.push(sql);
      return query(sql, params);
    }) as unknown as CompleteQueryFn;
    txQueries.push(collected);
    return fn(txQuery);
  }) as unknown as CompleteUploadDeps["runInTransaction"];

  const deps: CompleteUploadDeps = {
    query,
    runInTransaction,
    checkUploadIntent: vi.fn().mockResolvedValue(true),
    consumeUploadIntent: vi.fn(
      async (_userId: string, _imageUuid: string, q: CompleteQueryFn) => {
        await q("delete from image_upload_intents where ... returning image_uuid", []);
        return true;
      },
    ),
    ownsCafe: vi.fn(async (cafeId: string, userId: string, q?: CompleteQueryFn) => {
      const db = q ?? query;
      const res = await db<{ id: string }>("select id from cafes where id = $1 and created_by = $2 and deleted_at is null", [cafeId, userId]);
      return res.rows.length > 0;
    }),
    ownsCheckin: vi.fn(async (checkinId: string, userId: string, q?: CompleteQueryFn) => {
      const db = q ?? query;
      const res = await db<{ cafe_id: string | null }>("select cafe_id from checkins where id = $1 and user_id = $2 and deleted_at is null", [checkinId, userId]);
      return res.rows.length > 0;
    }),
    attachImageToCafe: vi.fn(async (params: { cafeId: string; userId: string; image: StoredImage; isCover?: boolean }, q?: CompleteQueryFn) => {
      const db = q ?? query;
      const res = await db<{ id: string }>("update cafes set gallery = ... where id = $3 and created_by = $4", [params.image, params.isCover, params.cafeId, params.userId]);
      return (res.rowCount ?? res.rows.length) > 0;
    }),
    attachImageToCheckin: vi.fn(async (params: { checkinId: string; userId: string; image: StoredImage }, q?: CompleteQueryFn) => {
      const db = q ?? query;
      const res = await db<{ id: string; cafe_id: string | null }>("update checkins set photos = ... where id = $2 and user_id = $3", [params.image, params.checkinId, params.userId]);
      if (res.rows.length === 0) return { ok: false, cafeId: null };
      return { ok: true, cafeId: res.rows[0].cafe_id };
    }),
    mergeIntoCafeGallery: vi.fn(async (cafeId: string, image: StoredImage, q?: CompleteQueryFn) => {
      const db = q ?? query;
      await db("update cafes set gallery = ... where id = $1", [cafeId, image]);
    }),
    getProcessUrls: vi.fn().mockResolvedValue(PROCESS_URLS),
    processImage: vi.fn().mockResolvedValue(PROCESSED),
    ...overrides,
  };

  return { deps, query: queryFn, calls, txQueries };
}

describe("completeImageUpload", () => {
  it("fails fast before remote work when the target is not owned", async () => {
    const { deps } = makeDeps({ ownsCheckin: vi.fn().mockResolvedValue(false) });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.ok).toBe(false);
    expect(result.attached).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_owned");
    }
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.processImage).not.toHaveBeenCalled();
    expect(deps.runInTransaction).not.toHaveBeenCalled();
  });

  it("attaches to a cafe target via repository inside the transaction", async () => {
    const { deps } = makeDeps();
    const result = await completeImageUpload(
      { id: "user-1" },
      { ...REQ, targetType: "cafe", targetId: CAFE_ID },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(result.attached).toBe(true);
    expect(deps.attachImageToCafe).toHaveBeenCalledTimes(1);
    expect(deps.attachImageToCheckin).not.toHaveBeenCalled();
  });

  it("runs intent consume, checkin append and cafe-gallery merge in ONE transaction", async () => {
    const { deps, txQueries } = makeDeps();
    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.ok).toBe(true);
    expect(result.attached).toBe(true);
    expect(result.storedImage?.source).toEqual({ type: "checkin", id: CHECKIN_ID });
    // All writes went through the SAME runInTransaction invocation.
    expect(txQueries).toHaveLength(1);
    expect(deps.attachImageToCheckin).toHaveBeenCalledTimes(1);
    expect(deps.mergeIntoCafeGallery).toHaveBeenCalledTimes(1);
  });

  it("fails fast before ownership/remote work when the upload was not issued to this user (#33)", async () => {
    const { deps } = makeDeps({ checkUploadIntent: vi.fn().mockResolvedValue(false) });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.ok).toBe(false);
    expect(result.attached).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("intent_not_found");
    }
    expect(deps.ownsCheckin).not.toHaveBeenCalled();
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.runInTransaction).not.toHaveBeenCalled();
  });

  it("rolls back the attach when the intent consume finds 0 rows (replay/expired/mismatch)", async () => {
    const { deps } = makeDeps({
      consumeUploadIntent: vi.fn().mockResolvedValue(false),
    });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.ok).toBe(false);
    expect(result.attached).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("intent_consumed");
    }
    expect(deps.attachImageToCheckin).not.toHaveBeenCalled();
    expect(deps.mergeIntoCafeGallery).not.toHaveBeenCalled();
  });

  it("returns target_gone when attach matches 0 rows in transaction", async () => {
    const { deps } = makeDeps({
      attachImageToCheckin: vi.fn().mockResolvedValue({ ok: false, cafeId: null }),
    });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.ok).toBe(false);
    expect(result.attached).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("target_gone");
    }
    expect(deps.mergeIntoCafeGallery).not.toHaveBeenCalled();
  });

  it("skips the gallery merge when the checkin has no cafe", async () => {
    const { deps } = makeDeps({
      attachImageToCheckin: vi.fn().mockResolvedValue({ ok: true, cafeId: null }),
    });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.ok).toBe(true);
    expect(result.attached).toBe(true);
    expect(deps.mergeIntoCafeGallery).not.toHaveBeenCalled();
  });

  it("default deps are constructible without touching pg/sharp at import time", () => {
    expect(() => defaultCompleteUploadDeps()).not.toThrow();
    const deps = defaultCompleteUploadDeps();
    expect(typeof deps.runInTransaction).toBe("function");
    expect(typeof deps.checkUploadIntent).toBe("function");
    expect(typeof deps.consumeUploadIntent).toBe("function");
    expect(typeof deps.ownsCafe).toBe("function");
    expect(typeof deps.ownsCheckin).toBe("function");
    expect(typeof deps.attachImageToCafe).toBe("function");
    expect(typeof deps.attachImageToCheckin).toBe("function");
    expect(typeof deps.mergeIntoCafeGallery).toBe("function");
  });
});
