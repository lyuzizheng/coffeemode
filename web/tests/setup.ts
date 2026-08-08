import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { rateLimiter } from "@/lib/rate-limit";

// Reset the in-memory rate limiter before every test so cumulative request
// counts do not cause unrelated tests to 429.
beforeEach(() => rateLimiter.reset());

// Unmount React trees between tests so rendered components from one file do not
// leak into the next.
afterEach(cleanup);
