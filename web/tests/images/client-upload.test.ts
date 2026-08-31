import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { toWebP, uploadPhoto } from "@/lib/images/client-upload";
import { MAX_UPLOAD_BYTES } from "@shared/images/constants";

describe("client-upload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("toWebP", () => {
    const OriginalImage = globalThis.Image;

    afterEach(() => {
      globalThis.Image = OriginalImage;
    });

    it("returns the file directly if already image/webp", async () => {
      const file = new File(["test content"], "photo.webp", { type: "image/webp" });
      const result = await toWebP(file);
      expect(result).toBe(file);
    });
    it("converts other formats to WebP using HTML5 canvas", async () => {
      const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-url");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      const mockBlob = new Blob(["webp content"], { type: "image/webp" });
      const getContextMock = vi.fn().mockReturnValue({
        drawImage: vi.fn(),
      });
      const toBlobMock = vi.fn().mockImplementation((cb: (blob: Blob | null) => void) => {
        cb(mockBlob);
      });

      vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        if (tagName === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: getContextMock,
            toBlob: toBlobMock,
          } as unknown as HTMLCanvasElement;
        }
        return document.createElement(tagName);
      });

      // Mock Image constructor
      const OriginalImage = globalThis.Image;
      class MockImage {
        naturalWidth = 800;
        naturalHeight = 600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_val: string) {
          queueMicrotask(() => {
            this.onload?.();
          });
        }
      }
      globalThis.Image = MockImage as unknown as typeof Image;

      const file = new File(["jpeg content"], "photo.jpg", { type: "image/jpeg" });
      const result = await toWebP(file);

      expect(result).toBe(mockBlob);
      expect(createObjectURLMock).toHaveBeenCalledWith(file);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");

      globalThis.Image = OriginalImage;
    });

    it("rejects on image load error", async () => {
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
      globalThis.URL.revokeObjectURL = vi.fn();

      class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_val: string) {
          queueMicrotask(() => {
            this.onerror?.();
          });
        }
      }
      globalThis.Image = MockImage as unknown as typeof Image;

      const file = new File(["bad data"], "photo.jpg", { type: "image/jpeg" });
      await expect(toWebP(file)).rejects.toThrow("photo_conversion_failed");

      globalThis.Image = OriginalImage;
    });
  });

  describe("uploadPhoto", () => {
    it("rejects if converted file exceeds MAX_UPLOAD_BYTES", async () => {
      const hugeFile = new File([new Uint8Array(MAX_UPLOAD_BYTES + 100)], "huge.webp", {
        type: "image/webp",
      });

      await expect(uploadPhoto(hugeFile)).rejects.toThrow("photo_too_large");
    });

    it("fetches presigned upload url and performs PUT upload", async () => {
      const file = new File(["valid image"], "photo.webp", { type: "image/webp" });

      const fetchMock = vi.fn();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          imageUuid: "img-12345",
          uploadUrl: "https://r2.example.com/upload",
          uploadHeaders: { "content-type": "image/webp" },
        }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
      });
      globalThis.fetch = fetchMock;

      const imageUuid = await uploadPhoto(file);
      expect(imageUuid).toBe("img-12345");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/images/upload",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://r2.example.com/upload",
        expect.objectContaining({
          method: "PUT",
          headers: { "content-type": "image/webp" },
        }),
      );
    });

    it("throws photo_upload_failed when presigned URL fetch fails", async () => {
      const file = new File(["valid image"], "photo.webp", { type: "image/webp" });

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Server error" }),
      });

      await expect(uploadPhoto(file)).rejects.toThrow("photo_upload_failed");
    });

    it("throws photo_upload_failed when PUT upload fails", async () => {
      const file = new File(["valid image"], "photo.webp", { type: "image/webp" });

      const fetchMock = vi.fn();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          imageUuid: "img-12345",
          uploadUrl: "https://r2.example.com/upload",
          uploadHeaders: {},
        }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: false,
      });
      globalThis.fetch = fetchMock;

      await expect(uploadPhoto(file)).rejects.toThrow("photo_upload_failed");
    });
  });
});
