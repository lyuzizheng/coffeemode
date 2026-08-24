import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { rateLimiter } from "@/lib/rate-limit";

// Reset the in-memory rate limiter before every test so cumulative request
// counts do not cause unrelated tests to 429. Integration suites pin
// RATE_LIMIT_BACKEND=memory via helpers/r2 and helpers/fixtures isolation.
beforeEach(async () => {
  try {
    await rateLimiter.reset();
  } catch {
    // Postgres backend may be unavailable when helpers are imported outside
    // a live DB (unit runs); rate-limit state is still effectively clean.
  }
});

// Unmount React trees between tests so rendered components from one file do not
// leak into the next.
afterEach(cleanup);
