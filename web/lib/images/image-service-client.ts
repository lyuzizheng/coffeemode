import { logError } from "@/lib/observability/server-log";
import "server-only";

import { REQUEST_ID_HEADER } from "@shared/request-id";
import { WORKER_TIMEOUT_MS } from "@/lib/http";
import type { CompleteImageRequest, UploadUrlResponse } from "@/types/images";

export class ImageServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Status the upstream worker returned (when it responded). */
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "ImageServiceError";
  }
}

interface PresignedUrl {
  url: string;
  headers: Record<string, string>;
}

export interface ProcessUrls {
  imageUuid: string;
  original: PresignedUrl;      // presigned GET for the uploaded original
  originalPut: PresignedUrl;  // presigned PUT to overwrite the original after resize
  card: PresignedUrl;
  thumbnail: PresignedUrl;
  publicUrls: {
    original: string;
    card: string;
    thumbnail: string;
  };
  keys: {
    original: string;
    card: string;
    thumbnail: string;
  };
}

function getEnv(): { url: string; token: string } {
  const url = process.env.IMAGE_SERVICE_URL;
  const token = process.env.IMAGE_SERVICE_TOKEN;
  if (!url || !token) {
    throw new Error(
      "IMAGE_SERVICE_URL and IMAGE_SERVICE_TOKEN must be set. See web/.env.example.",
    );
  }
  return { url, token };
}

function headers(token: string, requestId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-image-service-token": token,
    [REQUEST_ID_HEADER]: requestId,
  };
}

/**
 * Sanitize an upstream worker failure into an ImageServiceError (review
 * 2026-08-09). The upstream response body is canceled without reading it —
 * it can contain worker internals and be unbounded in size — and a worker
 * 401 (bad service token) must not surface as a user-facing 401. Mirrors
 * the poi-client pattern.
 */
function upstreamError(endpoint: "upload" | "complete" | "delete", response: Response, requestId: string): ImageServiceError {
  const upstreamStatus = response.status;
  // Benign: best-effort cancel of unread upstream response stream.
  void response.body?.cancel().catch(() => {});
  logError({ route: `image-service ${endpoint}`, error: { status: upstreamStatus }, requestId });

  let message = "Image service returned an error";
  let status = upstreamStatus;
  if (upstreamStatus === 401) {
    // Service-token mismatch: this is our misconfiguration, not the user's.
    message = "Image service unavailable";
    status = 502;
  } else if (upstreamStatus === 404) {
    message = "Image not found";
  } else if (upstreamStatus === 413 || upstreamStatus === 422) {
    message = "Image rejected by the image service";
  } else if (upstreamStatus >= 500) {
    message = "Image service unavailable";
  } else if (upstreamStatus >= 400) {
    message = "Invalid image request";
  }
  return new ImageServiceError(message, status, upstreamStatus);
}

/**
 * Wrap a transport failure (DNS, refused, AbortSignal timeout) in
 * ImageServiceError so the route boundary sees the same typed error as an
 * upstream response — 502 `image_service_error`, never a bare 500
 * (spec 0011 D5/BRAWUKA-537).
 */
function transportError(endpoint: "upload" | "complete" | "delete", error: unknown, requestId: string): ImageServiceError {
  logError({ route: `image-service ${endpoint}`, error, requestId });
  return new ImageServiceError("Image service unavailable", 502);
}

// D7 correlation: callers pass apiRoute's ctx.requestId straight through so
// the worker's access/error lines join the web lines. Non-route callers
// omit it and get a fresh id. Takes the id string, never the Request — a
// second getRequestId(inbound) here would mint a different UUID when the
// header is absent and silently break the D7 join (BRAWUKA-539 review).
function resolveId(requestId?: string): string {
  return requestId ?? crypto.randomUUID();
}

export async function requestUploadUrl(size: number, requestId?: string): Promise<UploadUrlResponse> {
  const { url, token } = getEnv();
  const resolvedId = resolveId(requestId);
  let response: Response;
  try {
    response = await fetch(`${url}/v1/images/upload`, {
      method: "POST",
      headers: headers(token, resolvedId),
      body: JSON.stringify({ size }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (error) {
    throw transportError("upload", error, resolvedId);
  }

  if (!response.ok) {
    throw upstreamError("upload", response, resolvedId);
  }

  return response.json();
}

/**
 * Fetch presigned process URLs for an uploaded original. `targetType` /
 * `targetId` are REQUIRED by the worker since #158 (cleanup contract): the
 * attach flow sends the real target ("cafe"|"checkin" + id); the creation
 * flow (issue #86), which processes images before its target exists, sends
 * targetType="provision" + targetId=<imageUuid> (PROVISION_TARGET_TYPE).
 */
export async function getProcessUrls(
  request: CompleteImageRequest & { userId?: string },
  requestId?: string,
): Promise<ProcessUrls> {
  const { url, token } = getEnv();
  const resolvedId = resolveId(requestId);
  let response: Response;
  try {
    response = await fetch(`${url}/v1/images/complete`, {
      method: "POST",
      headers: headers(token, resolvedId),
      body: JSON.stringify({
        imageUuid: request.imageUuid,
        userId: request.userId,
        targetType: request.targetType,
        targetId: request.targetId,
      }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (error) {
    throw transportError("complete", error, resolvedId);
  }

  if (!response.ok) {
    throw upstreamError("complete", response, resolvedId);
  }

  return response.json();
}

/**
 * Best-effort R2 compensation (BRAWUKA-279): delete the variants `processImage`
 * wrote after the DB transaction rolled back. The worker derives keys from
 * `imageUuid`, so no key material crosses this boundary. With `keepOriginal`
 * only the derived variants (`card/`, `thumbnail/`) are deleted and the
 * original survives for a retry; otherwise all three variants go. Missing
 * variants are reported, never errors; throws ImageServiceError only on
 * transport/upstream failure so callers can log it without failing the
 * already-failed write.
 */
export async function deleteImageVariants(
  imageUuid: string,
  options?: { keepOriginal?: boolean },
  requestId?: string,
): Promise<void> {
  const { url, token } = getEnv();
  const resolvedId = resolveId(requestId);
  let response: Response;
  try {
    response = await fetch(`${url}/v1/images/delete`, {
      method: "POST",
      headers: headers(token, resolvedId),
      body: JSON.stringify({ imageUuid, ...(options?.keepOriginal ? { keepOriginal: true } : {}) }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (error) {
    throw transportError("delete", error, resolvedId);
  }

  if (!response.ok) {
    throw upstreamError("delete", response, resolvedId);
  }
  // Benign: drain the small JSON body; the deleted/missing split is only
  // telemetry for the compensation log, not control flow.
  await response.body?.cancel().catch(() => {});
}
