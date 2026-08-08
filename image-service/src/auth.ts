import type { Env } from "./types";

function extractToken(request: Request): string | null {
  const header = request.headers.get("x-image-service-token");
  if (header) return header;

  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean } } }).crypto?.subtle;
  if (typeof subtle?.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(a, b);
  }

  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = extractToken(request);
  if (!token || !env.IMAGE_SERVICE_TOKEN) return false;

  const enc = new TextEncoder();
  const provided = enc.encode(token);
  const expected = enc.encode(env.IMAGE_SERVICE_TOKEN);

  if (provided.byteLength !== expected.byteLength) {
    // Compare the expected token against itself so the failure path still
    // performs a constant-time comparison of the expected length.
    timingSafeEqual(expected, expected);
    return false;
  }

  return timingSafeEqual(provided, expected);
}
