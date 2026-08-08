import "server-only";

import type { CompleteImageRequest, UploadUrlResponse } from "@/types/images";

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

export async function requestUploadUrl(): Promise<UploadUrlResponse> {
  const { url, token } = getEnv();
  const response = await fetch(`${url}/v1/images/upload`, {
    method: "POST",
    headers: headers(token),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown error");
    throw new Error(`image-service upload request failed: ${response.status} ${body}`);
  }

  return response.json();
}

export async function getProcessUrls(
  request: CompleteImageRequest & { userId?: string },
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
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown error");
    throw new Error(`image-service complete request failed: ${response.status} ${body}`);
  }

  return response.json();
}
