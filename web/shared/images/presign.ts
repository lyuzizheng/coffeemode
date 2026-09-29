/**
 * Presigned SigV4 URL composition for image object storage — the single owner
 * of the request construction shared by the production signer
 * (`image-service/src/r2.ts`) and the local MinIO harness
 * (`web/tests/helpers/r2.ts`), BRAWUKA-738.
 *
 * Dependency-free on purpose: `web/shared/**` is typechecked by the Worker as
 * well, and image-service's gate installs no web dependencies, so the SigV4
 * client is injected through the config (Adapter: aws4fetch's `AwsClient` in
 * both runtimes) rather than imported here.
 */
import type { PresignedUrl } from "./types";

/** An S3-compatible store address; a trailing slash on `endpoint` is ignored. */
export interface StoreLocation {
  endpoint: string;
  bucket: string;
}

/** The SigV4 surface presigning needs; `AwsClient` satisfies it. */
export interface QuerySigner {
  sign(
    request: Request,
    init: { aws: { signQuery: boolean; allHeaders?: boolean } },
  ): Promise<Request>;
}

export interface PresignConfig extends StoreLocation {
  signer: QuerySigner;
}

export function objectUrl(store: StoreLocation, key: string): string {
  const base = store.endpoint.replace(/\/+$/, "");
  return `${base}/${store.bucket}/${key}`;
}

function signedHeadersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    // Host is implicit from the URL; the caller must not send it explicitly.
    if (name.toLowerCase() !== "host") {
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

export interface PutUrlOptions {
  /** URL TTL in seconds. Callers own the product default (env var / test constant). */
  expiresSeconds: number;
  customMetadata?: Record<string, string>;
  cacheControl?: string;
  contentLength?: number;
}

export async function presignedPutUrl(
  config: PresignConfig,
  key: string,
  contentType: string,
  options: PutUrlOptions,
): Promise<PresignedUrl> {
  const url = `${objectUrl(config, key)}?X-Amz-Expires=${options.expiresSeconds}`;
  const request = new Request(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      ...(options.contentLength !== undefined
        ? { "Content-Length": String(options.contentLength) }
        : {}),
      ...(options.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
      ...metadataHeaders(options.customMetadata),
    },
  });
  // allHeaders signs Content-Type and the x-amz-meta-* headers, so the uploader
  // cannot swap the MIME type or metadata without breaking the signature.
  // When contentLength is provided, Content-Length is also part of the SigV4
  // sign input so the store still rejects size-mismatched bodies — but it is
  // NEVER returned below: fetch (undici/browsers) derives Content-Length from
  // the body and rejects a manually set value (BRAWUKA-338).
  const signed = await config.signer.sign(request, { aws: { signQuery: true, allHeaders: true } });
  const headers = signedHeadersToRecord(signed.headers);
  // Fetch is case-insensitive, but most callers expect the canonical capitalisation.
  delete headers["content-type"];
  headers["Content-Type"] = contentType;
  delete headers["content-length"];
  if (options.cacheControl) {
    delete headers["cache-control"];
    headers["Cache-Control"] = options.cacheControl;
  }
  return { url: signed.url.toString(), headers };
}

export async function presignedGetUrl(
  config: PresignConfig,
  key: string,
  expiresSeconds: number,
): Promise<PresignedUrl> {
  const url = `${objectUrl(config, key)}?X-Amz-Expires=${expiresSeconds}`;
  const signed = await config.signer.sign(new Request(url), { aws: { signQuery: true } });
  return {
    url: signed.url.toString(),
    headers: signedHeadersToRecord(signed.headers),
  };
}
