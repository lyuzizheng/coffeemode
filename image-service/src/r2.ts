import { AwsClient } from "aws4fetch";
import type { Env, PresignedUrl } from "./types";
import { DEFAULT_UPLOAD_URL_TTL_SECONDS } from "./constants";

export function r2Endpoint(env: Env, key: string): string {
  const base = env.R2_ENDPOINT
    ? env.R2_ENDPOINT.replace(/\/+$/, "")
    : `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return `${base}/${env.R2_BUCKET_NAME}/${key}`;
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

export function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_URL_TTL_SECONDS;
}

function signedHeadersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    // Host is implicit from the URL; the caller must not send it explicitly.
    if (lower !== "host") {
      result[name] = value;
    }
  });
  return result;
}

function metadataHeaders(customMetadata?: Record<string, string>): Record<string, string> {
  if (!customMetadata) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(customMetadata)) {
    headers[`x-amz-meta-${key.toLowerCase()}`] = value;
  }
  return headers;
}

export async function presignedPutUrl(
  env: Env,
  key: string,
  contentType: string,
  options?: {
    expiresSeconds?: number;
    customMetadata?: Record<string, string>;
    cacheControl?: string;
    contentLength?: number;
  },
): Promise<PresignedUrl> {
  const ttl = options?.expiresSeconds ?? ttlSeconds(env);
  const url = `${r2Endpoint(env, key)}?X-Amz-Expires=${ttl}`;
  const request = new Request(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      ...(options?.contentLength !== undefined
        ? { "Content-Length": String(options.contentLength) }
        : {}),
      ...(options?.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
      ...metadataHeaders(options?.customMetadata),
    },
  });
  // allHeaders signs Content-Type and the x-amz-meta-* headers, so the uploader
  // cannot swap the MIME type or metadata without breaking the signature.
  // When contentLength is provided, Content-Length is also signed so R2 can
  // reject uploads that do not match the declared size.
  const signed = await r2Client(env).sign(request, {
    aws: { signQuery: true, allHeaders: true },
  });
  const headers = signedHeadersToRecord(signed.headers);
  // Fetch is case-insensitive, but most callers expect the canonical capitalisation.
  delete headers["content-type"];
  headers["Content-Type"] = contentType;
  if (options?.contentLength !== undefined) {
    delete headers["content-length"];
    headers["Content-Length"] = String(options.contentLength);
  }
  if (options?.cacheControl) {
    delete headers["cache-control"];
    headers["Cache-Control"] = options.cacheControl;
  }
  return { url: signed.url.toString(), headers };
}

export async function presignedGetUrl(
  env: Env,
  key: string,
  expiresSeconds?: number,
): Promise<PresignedUrl> {
  const ttl = expiresSeconds ?? ttlSeconds(env);
  const url = `${r2Endpoint(env, key)}?X-Amz-Expires=${ttl}`;
  const request = new Request(url);
  const signed = await r2Client(env).sign(request, { aws: { signQuery: true } });
  return {
    url: signed.url.toString(),
    headers: signedHeadersToRecord(signed.headers),
  };
}
