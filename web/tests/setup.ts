import { File as NodeFile, Blob as NodeBlob } from "node:buffer";

// JSDOM provides a JS-based File/Blob implementation that Node's native C++
// structuredClone does not recognize, causing IndexedDB structured cloning
// (e.g. fake-indexeddb) to serialize File/Blob instances into empty objects {}.
// Restoring native File/Blob ensures IndexedDB structured cloning preserves
// Blob/File payloads across stores.
if (typeof NodeFile !== "undefined") {
  (globalThis as unknown as { File: unknown }).File = NodeFile;
  if (typeof window !== "undefined") {
    (window as unknown as { File: unknown }).File = NodeFile;
  }
}
if (typeof NodeBlob !== "undefined") {
  (globalThis as unknown as { Blob: unknown }).Blob = NodeBlob;
  if (typeof window !== "undefined") {
    (window as unknown as { Blob: unknown }).Blob = NodeBlob;
  }
}

import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { rateLimiter } from "@/lib/rate-limit";

// Reset the in-memory rate limiter before every test so cumulative request
// counts do not cause unrelated tests to 429. Integration suites that need
// `RATE_LIMIT_BACKEND=memory` set it in their own `beforeAll` / env;
// unit runs may have no Postgres — failure there is expected and ignored.
beforeEach(async () => {
  try {
    await rateLimiter.reset();
  } catch {
    // Postgres backend unavailable in unit runs (no DB) — ignore; any
    // other failure would be a real bug but this suite has no DB assertion.
  }
});

// Unmount React trees between tests so rendered components from one file do not
// leak into the next.
afterEach(cleanup);
