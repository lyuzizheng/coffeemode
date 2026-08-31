import { MAX_UPLOAD_BYTES } from "@shared/images/constants";
import type { UploadUrlResponse } from "@/types/images";

/**
 * Client-side HTML5 canvas image resizing and WebP compression.
 * Scales down to a maximum dimension of 4096px and converts to image/webp.
 */
export function toWebP(file: File): Promise<Blob> {
  if (file.type === "image/webp") return Promise.resolve(file);
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
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

  const uploadResponse = await fetch("/api/images/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ size: webp.size }),
  });
  const uploadData = (await uploadResponse.json().catch(() => null)) as UploadUrlResponse | null;
  if (!uploadResponse.ok || !uploadData?.uploadUrl || !uploadData.imageUuid) {
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
