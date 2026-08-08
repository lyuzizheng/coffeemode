import "@testing-library/jest-dom/vitest";
import { rateLimiter } from "@/lib/rate-limit";

// Reset the in-memory rate limiter between test files so cumulative request
// counts do not cause unrelated tests to 429.
rateLimiter.reset();
