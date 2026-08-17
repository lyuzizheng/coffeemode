import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
    consumeUploadIntent: vi.fn().mockResolvedValue(true),
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
    expect(deps.getProcessUrls).toHaveBeenCalledWith({ imageUuid: IMG_A, userId: USER });
  });

  it("fails fast: an id without a valid intent is rejected before ANY processing", async () => {
    const deps = fakeDeps({
      checkUploadIntent: vi.fn().mockResolvedValue(false),
    });

    await expect(provisionPhotos(USER, [IMG_A], deps)).rejects.toBeInstanceOf(PhotoIntentError);
    expect(deps.getProcessUrls).not.toHaveBeenCalled();
    expect(deps.processImage).not.toHaveBeenCalled();
  });

  it("processes sequentially and stops at the first bad intent", async () => {
    const deps = fakeDeps({
      checkUploadIntent: vi
        .fn()
        .mockResolvedValueOnce(true) // IMG_A ok — gets processed
        .mockResolvedValueOnce(false), // IMG_B rejected
    });

    await expect(provisionPhotos(USER, [IMG_A, IMG_B], deps)).rejects.toBeInstanceOf(
      PhotoIntentError,
    );
    expect(deps.processImage).toHaveBeenCalledTimes(1); // IMG_A only
    expect(deps.processImage).toHaveBeenCalledWith(IMG_A, expect.anything());
  });

  it("returns an empty list for no photo ids without touching deps", async () => {
    const deps = fakeDeps();
    await expect(provisionPhotos(USER, [], deps)).resolves.toEqual([]);
    expect(deps.checkUploadIntent).not.toHaveBeenCalled();
  });
});

describe("consumeProvisionedIntents", () => {
  it("consumes every intent on the transaction's query fn", async () => {
    const q = vi.fn();
    const deps = fakeDeps();
    await consumeProvisionedIntents(USER, [IMG_A, IMG_B], q, deps);

    expect(deps.consumeUploadIntent).toHaveBeenNthCalledWith(1, USER, IMG_A, q);
    expect(deps.consumeUploadIntent).toHaveBeenNthCalledWith(2, USER, IMG_B, q);
  });

  it("throws PhotoIntentError on the first id that fails to consume", async () => {
    const deps = fakeDeps({
      consumeUploadIntent: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });

    await expect(
      consumeProvisionedIntents(USER, [IMG_A, IMG_B], vi.fn(), deps),
    ).rejects.toBeInstanceOf(PhotoIntentError);
  });
});
