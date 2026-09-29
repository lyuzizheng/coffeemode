import { AwsClient } from "aws4fetch";
import type { Env } from "./types";
import type { PresignedUrl } from "../../web/shared/images/types";
import {
  objectUrl,
  presignedGetUrl as signPresignedGetUrl,
  presignedPutUrl as signPresignedPutUrl,
  type PresignConfig,
  type PutUrlOptions,
  type StoreLocation,
} from "../../web/shared/images/presign";
import { DEFAULT_UPLOAD_URL_TTL_SECONDS } from "./constants";

/** Store address from the Worker's bindings; `R2_ENDPOINT` (MinIO) wins over derived R2. */
function storeLocation(env: Env): StoreLocation {
  return {
    endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET_NAME,
  };
}

export function r2Endpoint(env: Env, key: string): string {
  return objectUrl(storeLocation(env), key);
}

export function publicUrl(env: Env, key: string): string {
  const base = env.R2_PUBLIC_URL.endsWith("/") ? env.R2_PUBLIC_URL.slice(0, -1) : env.R2_PUBLIC_URL;
  return `${base}/${key}`;
}

function r2Client(env: Env): AwsClient {
  return new AwsClient({
    service: "s3",
    region: "auto",
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
}

/** Narrow adapter from the Worker's bindings to the shared presigner (BRAWUKA-738). */
function presignConfig(env: Env): PresignConfig {
  return { ...storeLocation(env), signer: r2Client(env) };
}

/** A storage response other than a missing object. */
export class R2HeadObjectError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `R2 HEAD failed with status ${status}`);
    this.name = "R2HeadObjectError";
  }
}

/**
 * HEAD an object and return its size, or null when missing.
 *
 * Local dev (R2_ENDPOINT set, e.g. MinIO) goes through the S3 client so the
 * existence/size check sees the same store the presigned uploads hit;
 * otherwise it uses the R2 binding (production, wrangler dev with local R2
 * simulation).
 */
export async function headObject(
  env: Env,
  key: string,
): Promise<{ size: number } | null> {
  if (env.R2_ENDPOINT) {
    const res = await r2Client(env).fetch(r2Endpoint(env, key), {
      method: "HEAD",
      redirect: "manual",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new R2HeadObjectError(res.status);
    const contentLength = res.headers.get("content-length");
    if (contentLength === null) {
      throw new R2HeadObjectError(res.status, "R2 HEAD succeeded but omitted Content-Length");
    }
    const size = Number(contentLength);
    if (Number.isNaN(size) || size < 0) {
      throw new R2HeadObjectError(res.status, `R2 HEAD returned invalid Content-Length: ${contentLength}`);
    }
    return { size };
  }
  const head = await env.R2_BUCKET.head(key);
  if (!head) return null;
  return { size: head.size };
}

/**
 * Delete the R2 objects at `keys`. The caller's compensation path is
 * best-effort and idempotent (a retry must not fail because a previous
 * attempt already deleted the object). On the S3/MinIO path a 404 DELETE is
 * reported in `missing`; on the binding path R2 delete itself is idempotent
 * so every key lands in `deleted`. Throws on a storage failure so the
 * caller can log it.
 */
export async function deleteObjects(
  env: Env,
  keys: string[],
): Promise<{ deleted: string[]; missing: string[] }> {
  const deleted: string[] = [];
  const missing: string[] = [];
  if (env.R2_ENDPOINT) {
    const aws = r2Client(env);
    for (const key of keys) {
      const res = await aws.fetch(r2Endpoint(env, key), { method: "DELETE" });
      if (res.ok || res.status === 404) {
        // Benign: drain the body so the socket can be reused.
        await res.body?.cancel().catch(() => {});
        (res.status === 404 ? missing : deleted).push(key);
      } else {
        // Benign: drain before throwing so the error path never leaks a stream.
        await res.body?.cancel().catch(() => {});
        throw new Error(`R2 DELETE ${key} failed with status ${res.status}`);
      }
    }
    return { deleted, missing };
  }
  for (const key of keys) {
    // R2 delete is idempotent: deleting a missing key succeeds, so no
    // per-key HEAD is needed (P2 review: the head was a wasted op per key).
    await env.R2_BUCKET.delete(key);
    deleted.push(key);
  }
  return { deleted, missing };
}

export function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_URL_TTL_SECONDS;
}

export async function presignedPutUrl(
  env: Env,
  key: string,
  contentType: string,
  options?: Omit<PutUrlOptions, "expiresSeconds"> & { expiresSeconds?: number },
): Promise<PresignedUrl> {
  return signPresignedPutUrl(presignConfig(env), key, contentType, {
    ...options,
    expiresSeconds: options?.expiresSeconds ?? ttlSeconds(env),
  });
}

export async function presignedGetUrl(
  env: Env,
  key: string,
  expiresSeconds?: number,
): Promise<PresignedUrl> {
  return signPresignedGetUrl(presignConfig(env), key, expiresSeconds ?? ttlSeconds(env));
}
