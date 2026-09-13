import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasShownLocateSettingsToast,
  markLocateSettingsToastShown,
  readOnboardingState,
  writeOnboardingState,
} from "@/lib/onboarding-store";

describe("onboarding-store (spec 0001 §Onboarding storage)", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });
  });

  it("returns null on a first visit and after corrupt writes", () => {
    expect(readOnboardingState()).toBeNull();
    store["coffeemode:onboarding:v1"] = "{not json";
    expect(readOnboardingState()).toBeNull();
    store["coffeemode:onboarding:v1"] = JSON.stringify("nope");
    expect(readOnboardingState()).toBeNull();
  });

  it("merges patches without dropping sibling fields", () => {
    writeOnboardingState({ onboarded: true, currentCity: "tokyo" });
    writeOnboardingState({ lastLocation: { lat: 35.6, lng: 139.6 } });
    const state = readOnboardingState();
    expect(state).toEqual({
      onboarded: true,
      currentCity: "tokyo",
      currentCityName: null,
      lastLocation: { lat: 35.6, lng: 139.6 },
    });
  });

  it("drops malformed fields on read instead of trusting storage", () => {
    store["coffeemode:onboarding:v1"] = JSON.stringify({
      onboarded: "yes",
      currentCity: 42,
      lastLocation: { lat: 999, lng: 0 },
    });
    expect(readOnboardingState()).toEqual({
      onboarded: false,
      currentCity: null,
      currentCityName: null,
      lastLocation: null,
    });
  });

  it("tracks the one-time settings toast flag (DG117)", () => {
    expect(hasShownLocateSettingsToast()).toBe(false);
    markLocateSettingsToastShown();
    expect(hasShownLocateSettingsToast()).toBe(true);
  });
});
