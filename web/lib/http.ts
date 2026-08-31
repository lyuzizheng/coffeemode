/**
 * Shared HTTP / fetch defaults.
 *
 * Worker calls (image-service, POI-service) are expected to be fast and
 * local-ish to the Next.js host. A short timeout prevents hanging requests from
 * blocking UI transitions.
 */
export const WORKER_TIMEOUT_MS = 5000;

/**
 * Safely extracts error message from API response JSON or returns the fallback.
 */
export async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return body?.message || body?.error || fallback;
}
