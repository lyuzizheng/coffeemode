import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkUploadIntent,
  consumeUploadIntent,
  recordUploadIntent,
} from "@/lib/db/image-uploads";

const poolQueryMock = vi.fn();

vi.mock("@/lib/db/postgres", () => ({
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

const USER = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const IMAGE = "12345678-1234-4123-9234-123456789abc";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("recordUploadIntent", () => {
  it("inserts the (image_uuid, user_id) binding", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    await recordUploadIntent(USER, IMAGE);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("insert into image_upload_intents");
    expect(params).toEqual([IMAGE, USER]);
  });

  it("rejects invalid ids before touching the database", async () => {
    await expect(recordUploadIntent("nope", IMAGE)).rejects.toThrow("Invalid user or image ID");
    await expect(recordUploadIntent(USER, "nope")).rejects.toThrow("Invalid user or image ID");
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe("checkUploadIntent", () => {
  it("is a read-only freshness-bounded lookup", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE }] });
    await expect(checkUploadIntent(USER, IMAGE)).resolves.toBe(true);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("select image_uuid from image_upload_intents");
    expect(sql).toContain("interval '1 hour'");
    expect(params).toEqual([IMAGE, USER]);
  });

  it("returns false for a missing/expired/mismatched intent and for invalid ids", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    await expect(checkUploadIntent(USER, IMAGE)).resolves.toBe(false);
    await expect(checkUploadIntent("nope", IMAGE)).resolves.toBe(false);
    expect(poolQueryMock).toHaveBeenCalledTimes(1); // invalid ids never hit the DB
  });
});

describe("consumeUploadIntent", () => {
  it("is a single-use DELETE ... RETURNING on the pool by default", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE }] });
    await expect(consumeUploadIntent(USER, IMAGE)).resolves.toBe(true);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("delete from image_upload_intents");
    expect(sql).toContain("returning image_uuid");
    expect(params).toEqual([IMAGE, USER]);
  });

  it("returns false when the delete consumes nothing (replay/expired/mismatch)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    await expect(consumeUploadIntent(USER, IMAGE)).resolves.toBe(false);
  });

  it("runs on an injected transaction connection when given one", async () => {
    const txQuery = vi.fn().mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE }] });
    await expect(consumeUploadIntent(USER, IMAGE, txQuery)).resolves.toBe(true);
    expect(txQuery).toHaveBeenCalledOnce();
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});
