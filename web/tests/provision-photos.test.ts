import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachProvisionedPhotos,
  compensateProvisionedPhotos,
  consumeProvisionedIntents,
  PhotoIntentError,
  provisionPhotos,
  type ProvisionPhotosDeps,
} from "@/lib/images/provision-photos";

/**
 * Unit tests for the issue-#86 provisioning seam. The create paths already
 * exercise this module with fake deps end-to-end (cafes/checkins tests);
 * these pin the module's own contract: fail-fast ordering, server-derived
 * fields, and single-use consume semantics.
 */

const USER = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const IMG_A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";
const IMG_B = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";

function fakeDeps(overrides: Partial<ProvisionPhotosDeps> = {}): ProvisionPhotosDeps {
  return {
    checkUploadIntent: vi.fn().mockResolvedValue(true),
    checkUploadIntents: vi.fn().mockImplementation((_: string, ids: string[]) => Promise.resolve(ids)),
    consumeUploadIntent: vi.fn().mockResolvedValue(true),
    consumeUploadIntents: vi.fn().mockResolvedValue(true),
    getProcessUrls: vi.fn().mockImplementation((req: { imageUuid: string }) =>
      Promise.resolve({
        keys: {
          original: `original/${req.imageUuid}.webp`,
          card: `card/${req.imageUuid}.webp`,
          thumbnail: `thumbnail/${req.imageUuid}.webp`,
        },
      }),
    ),
    processImage: vi.fn().mockResolvedValue({ width: 1600, height: 1200 }),
    restampOriginal: vi.fn().mockResolvedValue(undefined),
    deleteProvisionedVariants: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionPhotos", () => {
  it("derives StoredImage fields server-side (keys, dimensions, by, at)", async () => {
    const deps = fakeDeps();
    const [photo] = await provisionPhotos(USER, [IMG_A], deps);

    expect(photo).toEqual({
      id: IMG_A,
      original: `original/${IMG_A}.webp`,
      card: `card/${IMG_A}.webp`,
      thumbnail: `thumbnail/${IMG_A}.webp`,
      w: 1600,
      h: 1200,
      by: USER,
      at: expect.any(String),
    });
    // No `source` yet — the target id only exists after the insert.
    expect(photo).not.toHaveProperty("source");
    // Pre-target stage marker (issue #158): the worker requires stage metadata.
    expect(deps.getProcessUrls).toHaveBeenCalledWith({
      imageUuid: IMG_A,
      userId: USER,
      targetType: "provision",
      targetId: IMG_A,
    });
  });
  it("fails fast: any id without a valid intent rejects the batch before ANY processing", async () => {
    const deps = fakeDeps({
      checkUploadIntents: vi.fn().mockResolvedValue([]),
    });

    await expect(provisionPhotos(USER, [IMG_A], deps)).rejects.toBeInstanceOf(PhotoIntentError);
    expect(deps.checkUploadIntents).toHaveBeenCalledWith(USER, [IMG_A]);
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.processImage).not.toHaveBeenCalled();
  });

  it("batch pre-checks all intents before ANY processing (fail-fast gate)", async () => {
    const deps = fakeDeps({
      checkUploadIntents: undefined,
      checkUploadIntent: vi
        .fn()
        .mockResolvedValueOnce(true) // IMG_A ok
        .mockResolvedValueOnce(false), // IMG_B rejected
    });

    await expect(provisionPhotos(USER, [IMG_A, IMG_B], deps)).rejects.toBeInstanceOf(
      PhotoIntentError,
    );
    // The batch gate resolves first, so neither photo burns remote work.
    expect(deps.processImage).not.toHaveBeenCalled();
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
  });

  it("prefers the batched checkUploadIntents seam (one DB round trip) when provided", async () => {
    const checkUploadIntent = vi.fn();
    const checkUploadIntents = vi.fn().mockResolvedValue([IMG_A]);
    const deps = fakeDeps({ checkUploadIntent, checkUploadIntents });

    await expect(provisionPhotos(USER, [IMG_A, IMG_B], deps)).rejects.toBeInstanceOf(
      PhotoIntentError,
    );
    expect(checkUploadIntents).toHaveBeenCalledTimes(1);
    expect(checkUploadIntents).toHaveBeenCalledWith(USER, [IMG_A, IMG_B]);
    expect(checkUploadIntent).not.toHaveBeenCalled();
    expect(deps.processImage).not.toHaveBeenCalled();
  });

  it("processes multiple photos concurrently with one intent batch", async () => {
    const deps = fakeDeps({
      checkUploadIntents: vi.fn().mockResolvedValue([IMG_A, IMG_B]),
    });

    const photos = await provisionPhotos(USER, [IMG_A, IMG_B], deps);
    expect(photos.map((p) => p.id)).toEqual([IMG_A, IMG_B]);
    expect(deps.checkUploadIntents).toHaveBeenCalledTimes(1);
    expect(deps.processImage).toHaveBeenCalledTimes(2);
  });

  it("returns results in input order under bounded concurrency", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const deps = fakeDeps({
      checkUploadIntents: vi.fn().mockResolvedValue([IMG_A, IMG_B]),
      processImage: vi.fn().mockImplementation(async (id: string) => {
        if (id === IMG_A) await firstGate;
        return { width: 1600, height: 1200 };
      }),
    });

    const pending = provisionPhotos(USER, [IMG_A, IMG_B], deps);
    releaseFirst();
    const photos = await pending;
    expect(photos.map((p) => p.id)).toEqual([IMG_A, IMG_B]);
  });

  it("pre-checks all intents in ONE batched query before processing any photo", async () => {
    const deps = fakeDeps({
      checkUploadIntents: vi.fn().mockResolvedValue([IMG_A, IMG_B]),
    });

    await provisionPhotos(USER, [IMG_A, IMG_B], deps);
    expect(deps.checkUploadIntents).toHaveBeenCalledTimes(1);
    expect(deps.checkUploadIntents).toHaveBeenCalledWith(USER, [IMG_A, IMG_B]);
    expect(deps.processImage).toHaveBeenCalledTimes(2);
  });
  it("returns an empty list for no photo ids without touching deps", async () => {
    const deps = fakeDeps();
    await expect(provisionPhotos(USER, [], deps)).resolves.toEqual([]);
    expect(deps.checkUploadIntents).not.toHaveBeenCalled();
  });

  it("compensates already-provisioned photos when a later photo fails mid-loop", async () => {
    const deps = fakeDeps({
      processImage: vi
        .fn()
        .mockResolvedValueOnce({ width: 1600, height: 1200 })
        .mockRejectedValueOnce(new Error("sharp blew up")),
    });
    await expect(provisionPhotos(USER, [IMG_A, IMG_B], deps)).rejects.toThrow("sharp blew up");
    expect(deps.deleteProvisionedVariants).toHaveBeenCalledTimes(1);
    expect(deps.deleteProvisionedVariants).toHaveBeenCalledWith(IMG_A);
  });
});

describe("consumeProvisionedIntents", () => {
  it("consumes all intents in ONE batched DELETE on the transaction's query fn", async () => {
    const q = vi.fn();
    const deps = fakeDeps();
    await consumeProvisionedIntents(USER, [IMG_A, IMG_B], q, deps);

    expect(deps.consumeUploadIntents).toHaveBeenCalledTimes(1);
    expect(deps.consumeUploadIntents).toHaveBeenCalledWith(USER, [IMG_A, IMG_B], q);
  });

  it("throws PhotoIntentError when the batch consume fails", async () => {
    const deps = fakeDeps({
      consumeUploadIntents: vi.fn().mockResolvedValue(false),
    });

    await expect(
      consumeProvisionedIntents(USER, [IMG_A, IMG_B], vi.fn(), deps),
    ).rejects.toBeInstanceOf(PhotoIntentError);
  });

  it("skips the DELETE for no photo ids", async () => {
    const deps = fakeDeps();
    await expect(consumeProvisionedIntents(USER, [], vi.fn(), deps)).resolves.toBeUndefined();
    expect(deps.consumeUploadIntents).not.toHaveBeenCalled();
  });

  it("falls back to per-id consume when the batch seam is absent (legacy fakes)", async () => {
    const q = vi.fn();
    const consumeUploadIntent = vi.fn().mockResolvedValue(true);
    const deps = fakeDeps({ consumeUploadIntents: undefined, consumeUploadIntent });
    await consumeProvisionedIntents(USER, [IMG_A, IMG_B], q, deps);
    expect(consumeUploadIntent).toHaveBeenNthCalledWith(1, USER, IMG_A, q);
    expect(consumeUploadIntent).toHaveBeenNthCalledWith(2, USER, IMG_B, q);
  });
});

describe("compensateProvisionedPhotos", () => {
  it("best-effort deletes every provisioned variant after a rollback", async () => {
    const deps = fakeDeps();
    await compensateProvisionedPhotos([IMG_A, IMG_B], deps);
    expect(deps.deleteProvisionedVariants).toHaveBeenCalledTimes(2);
    expect(deps.deleteProvisionedVariants).toHaveBeenCalledWith(IMG_A);
    expect(deps.deleteProvisionedVariants).toHaveBeenCalledWith(IMG_B);
  });

  it("is a no-op without a delete dep (sweeper backstop)", async () => {
    const { checkUploadIntent, checkUploadIntents, consumeUploadIntent, consumeUploadIntents, getProcessUrls, processImage } = fakeDeps();
    await expect(
      compensateProvisionedPhotos([IMG_A], { checkUploadIntent, checkUploadIntents, consumeUploadIntent, consumeUploadIntents, getProcessUrls, processImage }),
    ).resolves.toBeUndefined();
  });
});

describe("attachProvisionedPhotos (BRAWUKA-400)", () => {
  const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66";

  it("re-marks every photo with the final checkin target and restamps the original", async () => {
    const deps = fakeDeps();
    const results = await attachProvisionedPhotos(USER, [IMG_A, IMG_B], CHECKIN, deps);

    expect(results).toEqual([
      { imageUuid: IMG_A, attached: true },
      { imageUuid: IMG_B, attached: true },
    ]);
    expect(deps.getProcessUrls).toHaveBeenCalledTimes(2);
    expect(deps.getProcessUrls).toHaveBeenCalledWith({
      imageUuid: IMG_A,
      userId: USER,
      targetType: "checkin",
      targetId: CHECKIN,
    });
    expect(deps.restampOriginal).toHaveBeenCalledTimes(2);
  });

  it("returns [] without touching deps for no photo ids", async () => {
    const deps = fakeDeps();
    await expect(attachProvisionedPhotos(USER, [], CHECKIN, deps)).resolves.toEqual([]);
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.restampOriginal).not.toHaveBeenCalled();
  });

  it("never throws on a per-photo failure: reports attached:false, rest succeed", async () => {
    const deps = fakeDeps({
      getProcessUrls: vi
        .fn()
        .mockRejectedValueOnce(new Error("presign down"))
        .mockImplementation((req: { imageUuid: string }) =>
          Promise.resolve({ keys: { original: `original/${req.imageUuid}.webp` } }),
        ),
    });
    const results = await attachProvisionedPhotos(USER, [IMG_A, IMG_B], CHECKIN, deps);

    expect(results).toEqual([
      { imageUuid: IMG_A, attached: false },
      { imageUuid: IMG_B, attached: true },
    ]);
    // The surviving photo still restamps exactly once.
    expect(deps.restampOriginal).toHaveBeenCalledTimes(1);
  });

  it("counts a legacy fake without restampOriginal as attached when the final presign succeeds", async () => {
    const deps = fakeDeps({ restampOriginal: undefined });
    const results = await attachProvisionedPhotos(USER, [IMG_A], CHECKIN, deps);

    expect(results).toEqual([{ imageUuid: IMG_A, attached: true }]);
    expect(deps.getProcessUrls).toHaveBeenCalledWith({
      imageUuid: IMG_A,
      userId: USER,
      targetType: "checkin",
      targetId: CHECKIN,
    });
  });
});
