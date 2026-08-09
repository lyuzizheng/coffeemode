import { MAX_UPLOAD_BYTES } from "./constants";

export type UploadSizeValidation =
  | { ok: true; size: number }
  | { ok: false; code: "missing" | "invalid" | "size_exceeded"; error: string };

/**
 * Validate a claimed upload size against the shared cap. Used by both the
 * web upload route and the image-service Worker so the rules and messages
 * stay identical (issue #26). `size` is REQUIRED: an omitted size produced
 * an uncapped presigned PUT, because Content-Length is only signed when a
 * size is declared — the cap must hold server-side, not by caller honesty.
 */
export function validateUploadSize(value: unknown): UploadSizeValidation {
  if (value === undefined) {
    return { ok: false, code: "missing", error: "size (number, bytes) is required" };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    return { ok: false, code: "invalid", error: "size must be a positive integer (bytes)" };
  }
  if (value > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "size_exceeded",
      error: `size must be at most ${MAX_UPLOAD_BYTES} bytes`,
    };
  }
  return { ok: true, size: value };
}
