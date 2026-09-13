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

// jsdom does not implement scrollIntoView; components that scroll a revealed
// element into view (check-in sign-in gate, BRAWUKA-247) need a callable
// no-op. Tests assert the call by spying on this prototype method.
if (typeof window !== "undefined" && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { rateLimiter } from "@/lib/rate-limit";

const POSTGRES_EXPECTED_RESET_ERROR_CODES: Record<string, true> = {
  ECONNREFUSED: true,
  ENOTFOUND: true,
  EHOSTUNREACH: true,
  ETIMEDOUT: true,
  ECONNRESET: true,
  EPIPE: true,
  EAI_AGAIN: true,
  // 42P01: Postgres error code for undefined_table.
  // In integration test suites (e.g. tests/db-helpers.test.ts, tests/devops/*.test.ts),
  // DATABASE_URL is set so rateLimiter selects PostgresRateLimiter, but schema migrations
  // have not yet run against those test databases.
  // Because `rateLimiter.reset()` executes strictly `DELETE FROM rate_limits`, 42P01
  // represents an expected unprovisioned state before migrations land.
  // Real configuration bugs (auth failed 28P01, invalid DB 3D000, syntax error 42601)
  // and runtime/type regressions do not yield 42P01 and continue to be re-thrown loudly.
  "42P01": true,
};

/**
 * Narrow errors to "Postgres unavailable / table unprovisioned" failures.
 * In unit test runs without a live Postgres daemon (ECONNREFUSED/ENOTFOUND) or
 * integration runs before table migrations land (42P01 / undefined_table on rate_limits),
 * failures are expected and safely skipped.
 * Any other failure (bad credentials, invalid database name, syntax errors,
 * unexpected runtime/type exceptions) must re-throw to fail the test loudly.
 */
export function isPostgresUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const code = Reflect.get(err, "code");
  if (typeof code === "string" && POSTGRES_EXPECTED_RESET_ERROR_CODES[code.toUpperCase()]) {
    return true;
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("ehostunreach") ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("connection terminated") ||
      msg.includes("connection timeout") ||
      msg.includes("connect timeout") ||
      msg.includes("could not connect to server") ||
      msg.includes("server closed the connection unexpectedly") ||
      msg.includes("relation \"rate_limits\" does not exist")
    );
  }

  return false;
}

// Reset the in-memory rate limiter before every test so cumulative request
// counts do not cause unrelated tests to 429. Integration suites that need
// `RATE_LIMIT_BACKEND=memory` set it in their own `beforeAll` / env;
// unit runs may have no Postgres — connection failure is expected and ignored.
// Any non-connection error (configuration bug, runtime exception) is re-thrown.
beforeEach(async () => {
  try {
    await rateLimiter.reset();
  } catch (err) {
    if (isPostgresUnavailableError(err)) {
      return;
    }
    throw err;
  }
});

// Unmount React trees between tests so rendered components from one file do not
// leak into the next.
afterEach(cleanup);
