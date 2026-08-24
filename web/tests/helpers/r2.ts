import { AwsClient } from "aws4fetch";

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

export function r2Endpoint(key: string, bucket: string = R2_BUCKET_NAME): string {
  const base = R2_ENDPOINT.replace(/\/+$/, "");
  return `${base}/${bucket}/${key}`;
}

export function r2Client(): AwsClient {
  return new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

// Mirrors image-service/src/r2.ts presigning (aws4fetch, signQuery+allHeaders);
// the worker's copy cannot be imported here without dragging workers-types into
// web's typecheck. Update the two together.
export async function presignedPutUrl(
  key: string,
  contentType: string,
  contentLength?: number,
  bucket: string = R2_BUCKET_NAME,
): Promise<{ url: string; headers: Record<string, string> }> {
  const url = `${r2Endpoint(key, bucket)}?X-Amz-Expires=600`;
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (contentLength !== undefined) headers["Content-Length"] = String(contentLength);
  const request = new Request(url, { method: "PUT", headers });
  const signed = await r2Client().sign(request, { aws: { signQuery: true, allHeaders: true } });
  const outHeaders: Record<string, string> = {};
  signed.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "host") outHeaders[k] = v;
  });
  delete outHeaders["content-type"];
  delete outHeaders["content-length"];
  outHeaders["Content-Type"] = contentType;
  if (contentLength !== undefined) outHeaders["Content-Length"] = String(contentLength);
  return { url: signed.url.toString(), headers: outHeaders };
}

export async function presignedGetUrl(
  key: string,
  bucket: string = R2_BUCKET_NAME,
): Promise<{ url: string; headers: Record<string, string> }> {
  const url = `${r2Endpoint(key, bucket)}?X-Amz-Expires=600`;
  const signed = await r2Client().sign(new Request(url), { aws: { signQuery: true } });
  const headers: Record<string, string> = {};
  signed.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "host") headers[k] = v;
  });
  return { url: signed.url.toString(), headers };
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
  const url = `${r2Endpoint(key, bucket)}?X-Amz-Expires=600`;
  const headers: Record<string, string> = { "Content-Type": "image/webp" };
  for (const [k, v] of Object.entries(metadata ?? {})) headers[`x-amz-meta-${k}`] = v;
  const request = new Request(url, { method: "PUT", headers });
  const signed = await r2Client().sign(request, { aws: { signQuery: true, allHeaders: true } });
  const outHeaders: Record<string, string> = {};
  signed.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "host") outHeaders[k] = v;
  });
  delete outHeaders["content-type"];
  outHeaders["Content-Type"] = "image/webp";
  for (const [k, v] of Object.entries(metadata ?? {})) outHeaders[`x-amz-meta-${k}`] = v;
  const res = await fetch(signed.url.toString(), {
    method: "PUT",
    headers: outHeaders,
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`PUT ${key} failed ${res.status}`);
}

export async function minioReachable(endpoint: string = R2_ENDPOINT): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/minio/health/live`, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status === 404;
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
