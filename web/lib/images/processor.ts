import "server-only";

import sharp from "sharp";
import type { OutputInfo } from "sharp";
import { MAX_UPLOAD_BYTES } from "@shared/images/constants";
import type { ProcessUrls } from "./image-service-client";

/**
 * Download guard for the image processor (bytes). Uploads are capped at
 * `MAX_UPLOAD_BYTES` (web/shared), but the processor must not trust
 * that alone: it streams the R2 original and aborts once this many bytes
 * arrive. The small headroom over the upload cap keeps legitimate uploads
 * from failing on rounding while still bounding memory to ~10 MB per
 * request.
 */
const MAX_ORIGINAL_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES + 512 * 1024;

export interface ProcessedImage {
  imageUuid: string;
  publicUrls: {
    original: string;
    card: string;
    thumbnail: string;
  };
  width: number;
  height: number;
}

const R2_DOWNLOAD_TIMEOUT_MS = 30000;
const R2_UPLOAD_TIMEOUT_MS = 30000;

/** Sharp's `limitInputPixels` guard — (2^13)^2 = 8192 x 8192.
 *  A 10 MB compressed image can still declare 16K x 16K, which would exhaust
 *  memory at decode time. The output variants are capped at 4096px, so
 *  8192px gives headroom for legitimate high-res uploads while bounding the
 *  decompression surface to ~67 MP. */
const MAX_INPUT_PIXELS = 67_108_864;

const WEBP_QUALITY = 80;

const ORIGINAL_MAX_DIMENSION = 4096;

const CARD_SIZE = { width: 400, height: 300 };
const THUMBNAIL_SIZE = { width: 200, height: 200 };

/**
 * Download the original image from R2 with a hard byte cap.
 *
 * The object was uploaded through a size-locked presigned PUT, but this
 * function must not trust that alone: an attacker-sized object buffered via
 * `arrayBuffer()` can exhaust memory on the server. We pre-check
 * Content-Length and then count bytes while streaming, aborting the moment
 * the cap is crossed.
 */
async function fetchOriginal(original: ProcessUrls["original"]): Promise<Buffer> {
  const response = await fetch(original.url, {
    headers: original.headers,
    signal: AbortSignal.timeout(R2_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "unknown error");
    throw new Error(`failed to download original image: ${response.status} ${body}`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ORIGINAL_DOWNLOAD_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `original image exceeds the ${MAX_ORIGINAL_DOWNLOAD_BYTES} byte download cap`,
    );
  }

  if (!response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_ORIGINAL_DOWNLOAD_BYTES) {
        throw new Error(
          `original image exceeds the ${MAX_ORIGINAL_DOWNLOAD_BYTES} byte download cap`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await response.body.cancel().catch(() => {});
    throw err;
  }
  return Buffer.concat(chunks);
}

async function uploadVariant(
  variant: ProcessUrls["card"],
  buffer: Buffer,
): Promise<void> {
  // sharp's toBuffer returns a Buffer view; slice only the bytes that belong
  // to the image in case the underlying ArrayBuffer pool has trailing data.
  const response = await fetch(variant.url, {
    method: "PUT",
    headers: variant.headers,
    body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    signal: AbortSignal.timeout(R2_UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "unknown error");
    throw new Error(`failed to upload image variant: ${response.status} ${body}`);
  }
}

async function resizeToBuffer(
  input: Buffer,
  options: {
    width: number;
    height: number;
    fit?: "inside" | "cover";
    withoutEnlargement?: boolean;
  },
): Promise<{ buffer: Buffer; info: OutputInfo }> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(options.width, options.height, {
      fit: options.fit ?? "cover",
      withoutEnlargement: options.withoutEnlargement ?? false,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, info };
}

export async function processImage(
  imageUuid: string,
  processUrls: ProcessUrls,
): Promise<ProcessedImage> {
  const originalBuffer = await fetchOriginal(processUrls.original);

  const [cappedOriginal, card, thumbnail] = await Promise.all([
    resizeToBuffer(originalBuffer, {
      width: ORIGINAL_MAX_DIMENSION,
      height: ORIGINAL_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    }),
    resizeToBuffer(originalBuffer, { width: CARD_SIZE.width, height: CARD_SIZE.height, fit: "cover" }),
    resizeToBuffer(originalBuffer, { width: THUMBNAIL_SIZE.width, height: THUMBNAIL_SIZE.height, fit: "cover" }),
  ]);

  await Promise.all([
    uploadVariant(processUrls.originalPut, cappedOriginal.buffer),
    uploadVariant(processUrls.card, card.buffer),
    uploadVariant(processUrls.thumbnail, thumbnail.buffer),
  ]);

  return {
    imageUuid,
    publicUrls: processUrls.publicUrls,
    width: cappedOriginal.info.width,
    height: cappedOriginal.info.height,
  };
}
