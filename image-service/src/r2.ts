import { AwsClient } from "aws4fetch";
import type { Env, PresignedUrl } from "./types";

const DEFAULT_TTL_SECONDS = 600;

export function r2Endpoint(env: Env, key: string): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`;
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

export function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
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
  },
): Promise<PresignedUrl> {
  const ttl = options?.expiresSeconds ?? ttlSeconds(env);
  const url = `${r2Endpoint(env, key)}?X-Amz-Expires=${ttl}`;
  const request = new Request(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      ...(options?.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
      ...metadataHeaders(options?.customMetadata),
    },
  });
  // allHeaders signs Content-Type and the x-amz-meta-* headers, so the uploader
  // cannot swap the MIME type or metadata without breaking the signature.
  const signed = await r2Client(env).sign(request, {
    aws: { signQuery: true, allHeaders: true },
  });
  const headers = signedHeadersToRecord(signed.headers);
  // Fetch is case-insensitive, but most callers expect the canonical capitalisation.
  delete headers["content-type"];
  headers["Content-Type"] = contentType;
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
