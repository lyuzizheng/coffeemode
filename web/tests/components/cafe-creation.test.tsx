import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CafePlaceSearch } from "@/components/cafe/cafe-place-search";
import { creationDraftKey } from "@/components/discovery/use-discovery-search";
import type { CreationDraft } from "@/components/discovery/use-discovery-search";
import { getPlaceSearchProviders } from "@/lib/places/providers";
import type { PlaceSearchProvider } from "@/lib/places/place-search";
import type { POI } from "@shared/places/types";
import messages from "../../messages/en.json";

// The registry is the seam the component reads; tests pin the seeding logic,
// not vendor SDKs.
vi.mock("@/lib/places/providers", () => ({
  getPlaceSearchProviders: vi.fn(),
}));

// No Turnstile sitekey in tests — the link tab's widget effect stays inert.
vi.mock("@/lib/security/turnstile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/turnstile-client")>();
  return { ...actual, getTurnstileSiteKey: vi.fn(() => null) };
});

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockProviders = vi.mocked(getPlaceSearchProviders);

const poiFixture: POI = {
  place_id: "poi-1",
  source: "google",
  name: "Cafe",
  lat: 1,
  lng: 1,
  address: null,
  types: ["cafe"],
  business_status: null,
  hours_json: null,
  fetched_at: "2026-09-24T00:00:00Z",
};

function provider(id: string, label: string): PlaceSearchProvider {
  return {
    id,
    label,
    search: vi.fn(async () => []),
    resolve: vi.fn(async () => poiFixture),
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function renderSearch(initialProvider: "google" | "apple" | null = null, key?: string) {
  return render(
    <CafePlaceSearch
      key={key}
      onSelectPOI={vi.fn()}
      onError={vi.fn()}
      onRequireSignIn={vi.fn()}
      mapkitConfigured={false}
      initialProvider={initialProvider}
    />,
    { wrapper: Wrapper },
  );
}

const linkTab = () => screen.getByRole("tab", { name: "Import from a maps link" });
const searchTab = () => screen.getByRole("tab", { name: "Search a place" });
const chip = (name: string) => screen.getByRole("button", { name });

describe("CafePlaceSearch initialProvider seeding (BRAWUKA-366)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviders.mockReturnValue([provider("google", "Google Maps"), provider("apple", "Apple Maps")]);
  });

  it("opens on the link tab with no seed", () => {
    renderSearch(null);

    expect(linkTab()).toHaveAttribute("aria-selected", "true");
    expect(searchTab()).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByPlaceholderText("Search for a cafe")).toBeNull();
    expect(screen.queryByRole("button", { name: "Google Maps" })).toBeNull();
  });

  it("preselects the seeded provider chip and opens on the search tab", () => {
    renderSearch("apple");

    expect(searchTab()).toHaveAttribute("aria-selected", "true");
    expect(linkTab()).toHaveAttribute("aria-selected", "false");
    expect(chip("Apple Maps")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Google Maps")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByPlaceholderText("Search for a cafe")).toBeInTheDocument();
  });

  it("falls back to the first provider but still opens on search when the seed is unknown", () => {
    // Apple off in app.yaml (or MapKit unconfigured): the registry holds only Google.
    mockProviders.mockReturnValue([provider("google", "Google Maps")]);

    renderSearch("apple");

    expect(searchTab()).toHaveAttribute("aria-selected", "true");
    expect(chip("Google Maps")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Apple Maps" })).toBeNull();
  });

  it("ignores a new initialProvider prop without a remount — the parent keys the sheet", () => {
    // Contract the DiscoveryOverlays key relies on: the seed is read once at
    // mount, so a provider-CTA switch must remount the pane to take effect.
    const { rerender } = render(
      <CafePlaceSearch
        key="google"
        onSelectPOI={vi.fn()}
        onError={vi.fn()}
        onRequireSignIn={vi.fn()}
        mapkitConfigured={false}
        initialProvider="google"
      />,
      { wrapper: Wrapper },
    );
    expect(chip("Google Maps")).toHaveAttribute("aria-pressed", "true");

    rerender(
      <CafePlaceSearch
        key="google"
        onSelectPOI={vi.fn()}
        onError={vi.fn()}
        onRequireSignIn={vi.fn()}
        mapkitConfigured={false}
        initialProvider="apple"
      />,
    );
    expect(chip("Google Maps")).toHaveAttribute("aria-pressed", "true");

    rerender(
      <CafePlaceSearch
        key="apple"
        onSelectPOI={vi.fn()}
        onError={vi.fn()}
        onRequireSignIn={vi.fn()}
        mapkitConfigured={false}
        initialProvider="apple"
      />,
    );
    expect(chip("Apple Maps")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("creationDraftKey (BRAWUKA-366 remount)", () => {
  const draft = (overrides: Partial<CreationDraft>): CreationDraft => ({
    poi: null,
    persist: false,
    provider: null,
    ...overrides,
  });

  it("keys provider drafts on the provider so CTA switches remount the sheet", () => {
    const google = creationDraftKey(draft({ provider: "google" }));
    const apple = creationDraftKey(draft({ provider: "apple" }));

    expect(google).not.toBe(apple);
    expect(google).not.toBe(creationDraftKey(null));
    expect(google).not.toBe(creationDraftKey(draft({})));
  });

  it("keys poi and prediction picks on the place, not the provider", () => {
    const withPoi = creationDraftKey(draft({ poi: poiFixture, provider: "google" }));
    const samePoiOtherProvider = creationDraftKey(draft({ poi: poiFixture, provider: "apple" }));
    expect(withPoi).toBe(samePoiOtherProvider);

    const prediction = { place_id: "pred-1", source: "google" as const, name: "Cafe", address: null, types: [] };
    const withPrediction = creationDraftKey(draft({ prediction, provider: "google" }));
    expect(withPrediction).toBe(creationDraftKey(draft({ prediction, provider: "apple" })));
    expect(withPrediction).not.toBe(withPoi);
  });
});
