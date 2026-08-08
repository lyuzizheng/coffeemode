/**
 * Shared HTTP / fetch defaults.
 *
 * Worker calls (image-service, POI-service) are expected to be fast and
 * local-ish to the Next.js host. A short timeout prevents hanging requests from
 * blocking UI transitions.
 */
export const WORKER_TIMEOUT_MS = 5000;
