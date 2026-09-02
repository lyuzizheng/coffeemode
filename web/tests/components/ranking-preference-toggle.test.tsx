import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RankingPreferenceToggle } from "@/components/search/ranking-preference-toggle";
import { getRankingPreference } from "@/lib/search/ranking-preference";
import en from "@/messages/en.json";

describe("RankingPreferenceToggle (DG136)", () => {
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

  function renderToggle(variant: "settings" | "onboarding" = "settings") {
    return render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RankingPreferenceToggle variant={variant} />
      </NextIntlClientProvider>,
    );
  }

  it("defaults to the relevance position when nothing is stored", () => {
    renderToggle();
    expect(screen.getByRole("radio", { name: "Closest match first" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("persists the choice to localStorage and moves the active segment", () => {
    renderToggle();
    fireEvent.click(screen.getByRole("radio", { name: "Great cafes first" }));

    expect(getRankingPreference()).toBe("good_first");
    expect(screen.getByRole("radio", { name: "Great cafes first" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("works without any account — storage only, no network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderToggle();
    fireEvent.click(screen.getByRole("radio", { name: "Great cafes first" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("onboarding variant leads with the onboarding copy", () => {
    renderToggle("onboarding");
    expect(
      screen.getByRole("heading", { name: "What should search show first?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });
});
