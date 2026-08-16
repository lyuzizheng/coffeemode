import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "pg";
import type { CompleteImageRequest } from "@/types/images";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
  type CompleteQueryFn,
  type CompleteUploadDeps,
} from "@/lib/images/complete";

const CAFE_ID = "11111111-1111-4111-9111-111111111111";
const CHECKIN_ID = "22222222-2222-4222-a222-222222222222";
const IMAGE_UUID = "12345678-1234-4123-9234-123456789abc";

const REQ: CompleteImageRequest = {
  imageUuid: IMAGE_UUID,
  targetType: "checkin",
  targetId: CHECKIN_ID,
  isCover: false,
};

const PROCESS_URLS = {
  imageUuid: IMAGE_UUID,
  original: { url: "get", headers: {} },
  originalPut: { url: "put", headers: {} },
  card: { url: "card", headers: {} },
  thumbnail: { url: "thumb", headers: {} },
  publicUrls: {
    original: "https://images.example.com/original/uuid.webp",
    card: "https://images.example.com/card/uuid.webp",
    thumbnail: "https://images.example.com/thumb/uuid.webp",
  },
  keys: {
    original: "original/uuid.webp",
    card: "card/uuid.webp",
    thumbnail: "thumb/uuid.webp",
  },
};

const PROCESSED = {
  imageUuid: IMAGE_UUID,
  publicUrls: PROCESS_URLS.publicUrls,
  width: 100,
  height: 80,
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
    // Issue #33 intent deps default to "issued to this user"; the consume
    // stub routes a marker statement through the tx so statement-order
    // assertions see it.
    checkUploadIntent: vi.fn().mockResolvedValue(true),
    consumeUploadIntent: vi.fn(
      async (_userId: string, _imageUuid: string, q: CompleteQueryFn) => {
        await q("delete from image_upload_intents where ... returning image_uuid", []);
        return true;
      },
    ),
    getProcessUrls: vi.fn().mockResolvedValue(PROCESS_URLS),
    processImage: vi.fn().mockResolvedValue(PROCESSED),
    ...overrides,
  };

  return { deps, query: queryFn, calls, txQueries };
}

describe("completeImageUpload", () => {
  it("fails fast before remote work when the target is not owned", async () => {
    const { deps } = makeDeps();
    const query = deps.query as unknown as ReturnType<typeof vi.fn>;
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.attached).toBe(false);
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.processImage).not.toHaveBeenCalled();
    expect(deps.runInTransaction).not.toHaveBeenCalled();
  });

  it("attaches to a cafe target with a single update inside the transaction", async () => {
    const { deps, calls } = makeDeps();
    const result = await completeImageUpload(
      { id: "user-1" },
      { ...REQ, targetType: "cafe", targetId: CAFE_ID },
      deps,
    );

    expect(result.attached).toBe(true);
    const updates = calls.filter((c) => c.sql.includes("update cafes"));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("created_by = $4");
  });

  it("runs intent consume, checkin append and cafe-gallery merge in ONE transaction", async () => {
    const { deps, calls, txQueries } = makeDeps();
    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.attached).toBe(true);
    expect(result.storedImage?.source).toEqual({ type: "checkin", id: CHECKIN_ID });
    // All writes went through the SAME runInTransaction invocation.
    expect(txQueries).toHaveLength(1);
    expect(txQueries[0]).toEqual([
      expect.stringContaining("image_upload_intents"),
      expect.stringContaining("update checkins"),
      expect.stringContaining("update cafes"),
    ]);
    const writes = calls.filter((c) => c.sql.includes("update "));
    expect(writes).toHaveLength(2);
  });

  it("fails fast before ownership/remote work when the upload was not issued to this user (#33)", async () => {
    const { deps, query } = makeDeps({ checkUploadIntent: vi.fn().mockResolvedValue(false) });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.attached).toBe(false);
    expect(query).not.toHaveBeenCalled(); // no ownership check either
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.runInTransaction).not.toHaveBeenCalled();
  });

  it("rolls back the attach when the intent consume finds 0 rows (replay/expired/mismatch)", async () => {
    const { deps, calls } = makeDeps({
      consumeUploadIntent: vi.fn().mockResolvedValue(false),
    });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.attached).toBe(false);
    expect(calls.some((c) => c.sql.includes("update checkins"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("update cafes"))).toBe(false);
  });

  it("skips the gallery merge when the checkin has no cafe", async () => {
    const { deps } = makeDeps();
    const query = deps.query as unknown as ReturnType<typeof vi.fn>;
    // Ownership pre-check: checkin exists but belongs to no cafe.
    query.mockResolvedValueOnce({ rows: [{ cafe_id: null }], rowCount: 1 });
    // Intent consume marker (result ignored by the stub).
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Attach update: returning cafe_id is null, so no gallery merge.
    query.mockResolvedValueOnce({ rows: [{ id: CHECKIN_ID, cafe_id: null }], rowCount: 1 });

    const result = await completeImageUpload({ id: "user-1" }, REQ, deps);

    expect(result.attached).toBe(true);
    const allSql = query.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allSql.some((sql) => sql.includes("update cafes"))).toBe(false);
  });

  it("default deps are constructible without touching pg/sharp at import time", () => {
    // defaultCompleteUploadDeps must not throw at construction; the heavy
    // modules are only imported when the returned functions are called.
    expect(() => defaultCompleteUploadDeps()).not.toThrow();
    const deps = defaultCompleteUploadDeps();
    expect(typeof deps.query).toBe("function");
    expect(typeof deps.runInTransaction).toBe("function");
    expect(typeof deps.checkUploadIntent).toBe("function");
    expect(typeof deps.consumeUploadIntent).toBe("function");
  });
});
