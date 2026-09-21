import { MAX_UPLOAD_BYTES } from "@shared/images/constants";
import { getImageMaxDimension } from "@/lib/client-env";
import { apiFetch, isUnauthorized } from "@/lib/http";
import type { UploadUrlResponse } from "@/types/images";

/**
 * Client-side HTML5 canvas image resizing and WebP compression.
 * Downscales to `images.maxOriginalDimension` (same product cap as the
 * server output, via NEXT_PUBLIC_IMAGE_MAX_DIMENSION) and converts to WebP.
 */
export function toWebP(file: File): Promise<Blob> {
  if (file.type === "image/webp") return Promise.resolve(file);
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    // A decoded image with no intrinsic size (e.g. an SVG without width/height)
    // reports 0×0 — the canvas would emit a 1×1 blank WebP, so reject it as an
    // unusable file rather than uploading an empty photo (BRAWUKA-453).
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("photo_invalid"));
      return;
    }
    const scale = Math.min(1, getImageMaxDimension() / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("photo_conversion_failed"))),
      "image/webp",
      0.9,
    );
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("photo_conversion_failed"));
  };
  image.src = objectUrl;
  return promise;
}

/**
 * Uploads a photo to R2 using presigned URL orchestration.
 * Converts to WebP, requests a presigned URL, and PUTs the payload.
 */
export async function uploadPhoto(file: File): Promise<string> {
  const webp = await toWebP(file);
  if (webp.size > MAX_UPLOAD_BYTES) throw new Error("photo_too_large");

  let uploadData: UploadUrlResponse;
  try {
    const data = await apiFetch<UploadUrlResponse>("/api/images/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ size: webp.size }),
    });
    if (!data?.uploadUrl || !data.imageUuid) throw new Error("photo_upload_failed");
    uploadData = data;
  } catch (cause) {
    // Session expiry between the last-check-in probe and publish surfaces
    // here as 401 (presigned URLs are issued to authenticated sessions
    // only). `apiFetch` already threw the shared "unauthorized" marker —
    // same convention as the check-in POST / PATCH / DELETE paths — so the
    // drawer opens the sign-in gate instead of trapping the user in a
    // photo-retry loop that can never succeed. Every other failure keeps
    // the photo vocabulary the form renders.
    if (isUnauthorized(cause)) throw cause;
    throw new Error("photo_upload_failed");
  }

  const putResponse = await fetch(uploadData.uploadUrl, {
    method: "PUT",
    headers: uploadData.uploadHeaders,
    body: webp,
  });
  if (!putResponse.ok) throw new Error("photo_upload_failed");
  return uploadData.imageUuid;
}
