import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProfileTabHistory } from "@/components/profile/profile-tab-history";
import { addRecentSearch } from "@/lib/search/recent-searches";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

// BRAWUKA-516: a Search History row hands its query to the map search via
// `/?q=` — the interim plain `/` link predates UnifiedSearchPanel.
describe("ProfileTabHistory", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    });
  });

  it("links each history row to the map with the query pre-filled", () => {
    addRecentSearch("omotesando koffee", "tokyo");
    addRecentSearch("Roastery & Sons", "singapore");

    render(<ProfileTabHistory baseId="profile-tabs" />, { wrapper: Wrapper });

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/?q=Roastery%20%26%20Sons");
    expect(links[1]).toHaveAttribute("href", "/?q=omotesando%20koffee");
  });
});
