import "server-only";

import sharp from "sharp";
import type { OutputInfo } from "sharp";
import type { ProcessUrls } from "./image-service-client";

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

async function fetchOriginal(original: ProcessUrls["original"]): Promise<Buffer> {
  const response = await fetch(original.url, {
    headers: original.headers,
    signal: AbortSignal.timeout(R2_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "unknown error");
    throw new Error(`failed to download original image: ${response.status} ${body}`);
  }
  return Buffer.from(await response.arrayBuffer());
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
  const { data, info } = await sharp(input, { limitInputPixels: 268_402_689 })
    .rotate()
    .resize(options.width, options.height, {
      fit: options.fit ?? "cover",
      withoutEnlargement: options.withoutEnlargement ?? false,
    })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, info };
}

export async function processImage(
  imageUuid: string,
  processUrls: ProcessUrls,
): Promise<ProcessedImage> {
  const originalBuffer = await fetchOriginal(processUrls.original);

  const [cappedOriginal, card, thumbnail] = await Promise.all([
    resizeToBuffer(originalBuffer, { width: 4096, height: 4096, fit: "inside", withoutEnlargement: true }),
    resizeToBuffer(originalBuffer, { width: 400, height: 300, fit: "cover" }),
    resizeToBuffer(originalBuffer, { width: 200, height: 200, fit: "cover" }),
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
