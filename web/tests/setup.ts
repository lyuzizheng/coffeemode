import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { rateLimiter } from "@/lib/rate-limit";

// Reset the in-memory rate limiter before every test so cumulative request
// counts do not cause unrelated tests to 429.
beforeEach(() => rateLimiter.reset());
