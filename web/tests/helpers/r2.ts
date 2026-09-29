import { AwsClient } from "aws4fetch";
import {
  objectUrl,
  presignedGetUrl as signPresignedGetUrl,
  presignedPutUrl as signPresignedPutUrl,
  type PresignConfig,
  type StoreLocation,
} from "@shared/images/presign";

export const DEFAULT_MINIO_ENDPOINT = "http://localhost:9000";

// Local MinIO service account created by `docker compose run --rm minio-init`
// (docker-compose.yml). Override only when targeting a different store; never
// inherit ambient R2_* credentials — this suite must stay on the local stack.
export const R2_ACCESS_KEY_ID = process.env.TEST_R2_ACCESS_KEY_ID ?? "imgtest";
export const R2_SECRET_ACCESS_KEY = process.env.TEST_R2_SECRET_ACCESS_KEY ?? "imgtest-secret";
export const R2_BUCKET_NAME = process.env.TEST_R2_BUCKET_NAME ?? "coffeemode";
export const R2_CLEANUP_BUCKET_NAME =
  process.env.TEST_R2_CLEANUP_BUCKET_NAME ?? process.env.TEST_R2_BUCKET_NAME ?? "coffeemode-cleanup-test";
export const R2_ENDPOINT = process.env.TEST_R2_ENDPOINT ?? DEFAULT_MINIO_ENDPOINT;

/** Harness URL TTL; the Worker's own default lives in image-service/src/constants.ts. */
const URL_TTL_SECONDS = 600;

function storeLocation(bucket: string = R2_BUCKET_NAME): StoreLocation {
  return { endpoint: R2_ENDPOINT, bucket };
}

/**
 * PUT/GET URLs come from the production presigner (BRAWUKA-738): the same
 * `web/shared/images/presign.ts` the Worker adapts in
 * `image-service/src/r2.ts`, so the signature input — Content-Type, the signed
 * Content-Length (BRAWUKA-338: signed, never handed to fetch),
 * `x-amz-meta-*` and Cache-Control — cannot drift from what production signs.
 */
function presignConfig(bucket: string = R2_BUCKET_NAME): PresignConfig {
  return { ...storeLocation(bucket), signer: r2Client() };
}

export function r2Endpoint(key: string, bucket: string = R2_BUCKET_NAME): string {
  return objectUrl(storeLocation(bucket), key);
}

export function r2Client(): AwsClient {
  return new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

export async function presignedPutUrl(
  key: string,
  contentType: string,
  contentLength?: number,
  options: { bucket?: string; metadata?: Record<string, string>; cacheControl?: string } = {},
): Promise<{ url: string; headers: Record<string, string> }> {
  return signPresignedPutUrl(presignConfig(options.bucket), key, contentType, {
    expiresSeconds: URL_TTL_SECONDS,
    contentLength,
    customMetadata: options.metadata,
    cacheControl: options.cacheControl,
  });
}

export async function presignedGetUrl(
  key: string,
  bucket: string = R2_BUCKET_NAME,
): Promise<{ url: string; headers: Record<string, string> }> {
  return signPresignedGetUrl(presignConfig(bucket), key, URL_TTL_SECONDS);
}

export async function headObject(
  key: string,
  bucket: string = R2_BUCKET_NAME,
): Promise<{ size: number } | null> {
  const res = await r2Client().fetch(r2Endpoint(key, bucket), { method: "HEAD", redirect: "manual" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${key} failed ${res.status}`);
  const len = res.headers.get("content-length");
  if (len === null) throw new Error("missing Content-Length");
  const size = Number(len);
  if (Number.isNaN(size)) throw new Error(`invalid Content-Length ${len}`);
  return { size };
}

export async function deleteObject(key: string, bucket: string = R2_BUCKET_NAME): Promise<void> {
  const res = await r2Client().fetch(r2Endpoint(key, bucket), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${key} failed with ${res.status}`);
  }
}

export async function objectExists(key: string, bucket: string = R2_BUCKET_NAME): Promise<boolean> {
  const res = await r2Client().fetch(r2Endpoint(key, bucket), { method: "HEAD", redirect: "manual" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HEAD ${key} failed ${res.status}`);
  return true;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  metadata?: Record<string, string>,
  bucket: string = R2_BUCKET_NAME,
): Promise<void> {
  const { url, headers } = await presignedPutUrl(key, "image/webp", undefined, { metadata, bucket });
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`PUT ${key} failed ${res.status}`);
}

export async function minioReachable(endpoint: string = R2_ENDPOINT): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/minio/health/live`, { signal: AbortSignal.timeout(2000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

export function makePayload(size: number): Uint8Array {
  return new Uint8Array(Buffer.alloc(size, 0x61));
}

export function tinyWebP(): Uint8Array {
  const b64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
  return new Uint8Array(Buffer.from(b64, "base64"));
}
