import "server-only";

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

function headers(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-image-service-token": token,
  };
}

/**
 * Sanitize an upstream worker failure into an ImageServiceError (review
 * 2026-08-09). The upstream response body is canceled without reading it —
 * it can contain worker internals and be unbounded in size — and a worker
 * 401 (bad service token) must not surface as a user-facing 401. Mirrors
 * the poi-client pattern.
 */
function upstreamError(endpoint: "upload" | "complete", response: Response): ImageServiceError {
  const upstreamStatus = response.status;
  void response.body?.cancel().catch(() => {});
  console.error("image-service error", { endpoint, status: upstreamStatus });

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

export async function requestUploadUrl(size: number): Promise<UploadUrlResponse> {
  const { url, token } = getEnv();
  const response = await fetch(`${url}/v1/images/upload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ size }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw upstreamError("upload", response);
  }

  return response.json();
}

/**
 * Fetch presigned process URLs for an uploaded original. `targetType` /
 * `targetId` are optional R2 custom-metadata hints for the worker — the
 * creation flow (issue #86) processes images before its target exists.
 */
export async function getProcessUrls(
  request: Omit<CompleteImageRequest, "targetType" | "targetId"> &
    Partial<Pick<CompleteImageRequest, "targetType" | "targetId">> & { userId?: string },
): Promise<ProcessUrls> {
  const { url, token } = getEnv();
  const response = await fetch(`${url}/v1/images/complete`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      imageUuid: request.imageUuid,
      userId: request.userId,
      targetType: request.targetType,
      targetId: request.targetId,
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw upstreamError("complete", response);
  }

  return response.json();
}
