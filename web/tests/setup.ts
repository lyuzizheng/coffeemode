import { beforeEach } from "vitest";
import { rateLimiter } from "@/lib/rate-limit";

/**
 * Shared vitest setup for the real-Postgres integration suites — the only test
 * mechanism in this repo (AGENTS.md §Testing philosophy: E2E only, no unit
 * tests). Runs before every `RUN_INTEGRATION=1` spec.
 *
 * Reset the in-memory rate limiter before every test so cumulative request
 * counts do not cause unrelated tests to 429.
 */
beforeEach(async () => {
  await rateLimiter.reset();
});
