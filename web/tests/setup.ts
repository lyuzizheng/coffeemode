import { File as NodeFile, Blob as NodeBlob } from "node:buffer";

/**
 * JSDOM polyfill alignment for IndexedDB structured cloning:
 *
 * 1. Why this is needed:
 *    JSDOM injects purely JavaScript-based File and Blob mocks on window and globalThis.
 *    When IndexedDB implementations (such as fake-indexeddb) serialize records, they invoke
 *    the host runtime's native C++ structuredClone(). Because Node's C++ structuredClone algorithm
 *    does not recognize JSDOM's JavaScript-level mock classes as Web API Blobs, it serializes
 *    them into empty plain objects {}.
 *    Replacing globalThis.File and globalThis.Blob with Node's native Web-standard File and Blob
 *    (from node:buffer) ensures structuredClone preserves binary Blob/File contents across
 *    all IndexedDB read/write operations.
 *
 * 2. Scope of impact:
 *    This setup file runs globally before vitest suites in web/. Node's native File and Blob conform
 *    to the standard W3C File API spec (arrayBuffer, slice, stream, text, size, type).
 *    All unit test suites in web/ pass deterministically under both Node 22 (CI) and newer Node releases.
 *
 * 3. Rollback / alternative:
 *    If an individual test specifically requires JSDOM's mock File implementation, it can import File
 *    directly from jsdom or restore the prototype locally. However, for tests exercising real IndexedDB
 *    storage with Blob/File payloads (such as pending check-in drafts), native Blob/File is required.
 */
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
