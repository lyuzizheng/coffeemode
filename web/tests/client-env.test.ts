import { afterEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/lib/config";
import {
  envPositiveInt,
  getCheckinNoteMaxChars,
  getDisplayNameMaxChars,
  getHandleMaxChars,
  getImageMaxDimension,
  getQueryGcTimeMs,
  getQueryPersistMaxAgeMs,
  getQueryStaleTimeMs,
  getSearchDebounceMs,
  getSearchMinQueryLength,
} from "@/lib/client-env";

// Client env channel (BRAWUKA-250): `next.config.ts` mirrors `app.yaml`
// values into `NEXT_PUBLIC_*` at build time. Fallbacks below mirror the same
// YAML values so dev/test (no Next env) behave identically — pinned here
// against `appConfig` so drift fails fast.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("envPositiveInt", () => {
  it("returns the fallback when missing, empty, or malformed", () => {
    // The parser takes the already-resolved value: callers pass static
    // `process.env.NEXT_PUBLIC_X` references so Next inlines them at build.
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ENV_PROBE", "");
    expect(envPositiveInt(process.env.NEXT_PUBLIC_CLIENT_ENV_PROBE, 7)).toBe(7);
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ENV_PROBE", "nope");
    expect(envPositiveInt(process.env.NEXT_PUBLIC_CLIENT_ENV_PROBE, 7)).toBe(7);
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ENV_PROBE", "0");
    expect(envPositiveInt(process.env.NEXT_PUBLIC_CLIENT_ENV_PROBE, 7)).toBe(7);
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ENV_PROBE", "12");
    expect(envPositiveInt(process.env.NEXT_PUBLIC_CLIENT_ENV_PROBE, 7)).toBe(12);
  });
});

describe("client config fallbacks match app.yaml", () => {
  it("falls back to the YAML-owned values without env", () => {
    expect(getCheckinNoteMaxChars()).toBe(appConfig.checkins.noteMaxChars);
    expect(getDisplayNameMaxChars()).toBe(appConfig.profile.displayNameMaxChars);
    expect(getHandleMaxChars()).toBe(appConfig.profile.handle.maxChars);
    expect(getImageMaxDimension()).toBe(appConfig.images.maxOriginalDimension);
    expect(getSearchMinQueryLength()).toBe(appConfig.search.client.minQueryLength);
    expect(getSearchDebounceMs()).toBe(appConfig.search.client.debounceMs);
    expect(getQueryStaleTimeMs()).toBe(appConfig.query.staleTimeMs);
    expect(getQueryGcTimeMs()).toBe(appConfig.query.gcTimeMs);
    expect(getQueryPersistMaxAgeMs()).toBe(appConfig.query.persistMaxAgeMs);
  });

  it("keeps the previously hardcoded client values (no behavior change)", () => {
    expect(getCheckinNoteMaxChars()).toBe(500);
    expect(getDisplayNameMaxChars()).toBe(24);
    expect(getHandleMaxChars()).toBe(30);
    expect(getImageMaxDimension()).toBe(4096);
    expect(getSearchMinQueryLength()).toBe(3);
    expect(getSearchDebounceMs()).toBe(400);
    expect(getQueryStaleTimeMs()).toBe(300_000);
    expect(getQueryGcTimeMs()).toBe(86_400_000);
    expect(getQueryPersistMaxAgeMs()).toBe(604_800_000);
  });

  it("honors env overrides from next.config.ts", () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKIN_NOTE_MAX", "600");
    expect(getCheckinNoteMaxChars()).toBe(600);
    vi.stubEnv("NEXT_PUBLIC_SEARCH_DEBOUNCE_MS", "250");
    expect(getSearchDebounceMs()).toBe(250);
    vi.stubEnv("NEXT_PUBLIC_QUERY_GC_TIME_MS", "3600000");
    expect(getQueryGcTimeMs()).toBe(3_600_000);
  });
});
