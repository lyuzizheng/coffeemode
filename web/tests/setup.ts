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
