import { render as rtlRender, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate, PlaceSearchProvider } from "@/lib/places/place-search";
import type { POI } from "@shared/places/types";
import type * as Http from "@/lib/http";
import { apiFetch, UNAUTHORIZED } from "@/lib/http";
import {
  executeWidgetForToken,
  getTurnstileSiteKey,
  removeResolveWidget,
  renderInvisibleResolveWidget,
  resetResolveWidget,
} from "@/lib/security/turnstile-client";
import { getPlaceSearchProviders } from "@/lib/places/providers";
import { CafePlaceSearch } from "@/components/cafe/cafe-place-search";
import en from "@/messages/en.json";

// BRAWUKA-734: the maps-link workflow (Turnstile lifecycle + resolve submit)
// and the provider search/details workflow live in separate always-mounted
// children that the coordinator shows/hides via `active`. These tests pin the
// cross-cutting contracts: tab switches preserve drafts, leaving the link tab
// destroys its widget and returning rebuilds it, provider init runs on mount
// regardless of the active tab, and the billed resolve path is unchanged.

vi.mock("@/lib/places/providers", () => ({
  getPlaceSearchProviders: vi.fn(),
}));

vi.mock("@/lib/security/turnstile-client", () => ({
  getTurnstileSiteKey: vi.fn(() => null),
  renderInvisibleResolveWidget: vi.fn(),
  removeResolveWidget: vi.fn(),
  resetResolveWidget: vi.fn(async () => {}),
  executeWidgetForToken: vi.fn(async () => "tok"),
}));

vi.mock("@/lib/http", async (orig) => ({
  ...(await orig<typeof Http>()),
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/onboarding-store", () => ({
  readOnboardingState: () => null,
}));

const render = (ui: React.ReactElement) => rtlRender(ui, { reactStrictMode: true });

const POI_FIXTURE: POI = {
  place_id: "pid-1",
  source: "google",
  name: "Blue Bottle",
  lat: 37.5,
  lng: -122.2,
  address: "1 Ferry Building",
  types: ["cafe"],
  business_status: "OPERATIONAL",
  hours_json: null,
  fetched_at: "2026-09-01T00:00:00.000Z",
};

const CANDIDATE: PlaceCandidate = {
  prediction: {
    place_id: "cand-1",
    source: "google",
    name: "Blue Bottle",
    address: "1 Ferry Building",
    types: ["cafe"],
  },
};

function makeProvider(overrides: Partial<PlaceSearchProvider> = {}): PlaceSearchProvider {
  return {
    id: "google",
    label: "Google",
    search: vi.fn(async () => [CANDIDATE]),
    resolve: vi.fn(async () => POI_FIXTURE),
    ...overrides,
  };
}

const mockedGetProviders = vi.mocked(getPlaceSearchProviders);
const mockedApiFetch = vi.mocked(apiFetch);
const mockedSiteKey = vi.mocked(getTurnstileSiteKey);
const mockedRenderWidget = vi.mocked(renderInvisibleResolveWidget);
const mockedRemoveWidget = vi.mocked(removeResolveWidget);
const mockedExecuteWidget = vi.mocked(executeWidgetForToken);
const mockedResetWidget = vi.mocked(resetResolveWidget);

function renderSheet(props: Partial<React.ComponentProps<typeof CafePlaceSearch>> = {}) {
  const onSelectPOI = vi.fn();
  const onError = vi.fn();
  const onRequireSignIn = vi.fn();
  const result = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CafePlaceSearch
        onSelectPOI={onSelectPOI}
        onError={onError}
        onRequireSignIn={onRequireSignIn}
        mapkitConfigured={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...result, onSelectPOI, onError, onRequireSignIn };
}

function linkForm() {
  return screen.getByPlaceholderText(en.create.mapsLinkPlaceholder).closest("form") as HTMLElement;
}

function searchPanel() {
  // `hidden: true` — the inactive panel stays mounted; role queries ignore it by default.
  return screen.getByRole("group", { name: en.create.provider, hidden: true }).parentElement as HTMLElement;
}

beforeEach(() => {
  let widgetSeq = 0;
  mockedGetProviders.mockReturnValue([makeProvider()]);
  mockedSiteKey.mockReturnValue(null);
  mockedApiFetch.mockResolvedValue(POI_FIXTURE);
  mockedRenderWidget.mockImplementation(async () => `w${++widgetSeq}`);
})

afterEach(() => {
  vi.clearAllMocks();
});

describe("CafePlaceSearch tab coordination", () => {
  it("starts on the link tab without initialProvider and keeps the provider panel hidden", () => {
    renderSheet();
    expect(screen.getByRole("tab", { name: en.create.importLink })).toHaveAttribute("aria-selected", "true");
    expect(linkForm()).not.toHaveAttribute("hidden");
    expect(searchPanel()).toHaveAttribute("hidden");
  });

  it("initialProvider preselects the search tab and its provider chip", () => {
    renderSheet({ initialProvider: "google" });
    expect(screen.getByRole("tab", { name: en.create.searchPlace })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Google" })).toHaveAttribute("aria-pressed", "true");
    expect(linkForm()).toHaveAttribute("hidden");
  });

  it("link → search → link preserves the entered maps URL", () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText(en.create.mapsLinkPlaceholder), {
      target: { value: "https://maps.google.com/?cid=1" },
    });
    fireEvent.click(screen.getByRole("tab", { name: en.create.searchPlace }));
    fireEvent.click(screen.getByRole("tab", { name: en.create.importLink }));
    expect(screen.getByPlaceholderText(en.create.mapsLinkPlaceholder)).toHaveValue(
      "https://maps.google.com/?cid=1",
    );
  });

  it("search → link → search preserves query text, provider selection and candidates", async () => {
    const provider = makeProvider();
    mockedGetProviders.mockReturnValue([provider]);
    renderSheet({ initialProvider: "google" });

    // Provider has no init → ready immediately; run a search to stage candidates.
    const input = screen.getByPlaceholderText(en.create.searchPlaceholder);
    fireEvent.change(input, { target: { value: "blue bottle" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Blue Bottle")).toBeInTheDocument();
    expect(provider.search).toHaveBeenCalledWith("blue bottle", undefined);

    // Round-trip through the link tab; the panel must come back intact.
    fireEvent.click(screen.getByRole("tab", { name: en.create.importLink }));
    expect(searchPanel()).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("tab", { name: en.create.searchPlace }));
    expect(searchPanel()).not.toHaveAttribute("hidden");
    expect(screen.getByPlaceholderText(en.create.searchPlaceholder)).toHaveValue("blue bottle");
    expect(screen.getByRole("button", { name: "Google" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Blue Bottle")).toBeInTheDocument();
  });

  it("with no providers only the link tab renders", () => {
    mockedGetProviders.mockReturnValue([]);
    renderSheet();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(linkForm()).not.toHaveAttribute("hidden");
  });
});

describe("maps-link workflow (Turnstile lifecycle)", () => {
  it("submitting with a sitekey mints a token and posts it; the widget resets after", async () => {
    mockedSiteKey.mockReturnValue("site-key");
    const { onSelectPOI } = renderSheet();
    await waitFor(() => expect(mockedRenderWidget).toHaveBeenCalled());
    mockedApiFetch.mockResolvedValue(POI_FIXTURE);

    fireEvent.change(screen.getByPlaceholderText(en.create.mapsLinkPlaceholder), {
      target: { value: "https://maps.google.com/?cid=42" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.create.resolveLink }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalled());
    expect(mockedExecuteWidget).toHaveBeenCalled();
    const body = JSON.parse(String(mockedApiFetch.mock.calls[0][1]?.body));
    expect(body).toEqual({
      maps_share_url: "https://maps.google.com/?cid=42",
      "cf-turnstile-response": "tok",
    });
    await waitFor(() => expect(onSelectPOI).toHaveBeenCalledWith(POI_FIXTURE));
    await waitFor(() => expect(mockedResetWidget).toHaveBeenCalled());
  });

  it("leaving the link tab removes the widget; returning renders a fresh one", async () => {
    mockedSiteKey.mockReturnValue("site-key");
    renderSheet();
    await waitFor(() => expect(mockedRenderWidget).toHaveBeenCalled());
    const renderedBefore = mockedRenderWidget.mock.calls.length;

    fireEvent.click(screen.getByRole("tab", { name: en.create.searchPlace }));
    await waitFor(() => expect(mockedRemoveWidget).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: en.create.importLink }));
    await waitFor(() =>
      expect(mockedRenderWidget.mock.calls.length).toBeGreaterThan(renderedBefore),
    );
  });

  it("submitting before the widget is ready surfaces resolveFailed and posts nothing", async () => {
    mockedSiteKey.mockReturnValue("site-key");
    let resolveRender!: (id: string) => void;
    mockedRenderWidget.mockImplementation(
      () => new Promise<string>((resolve) => (resolveRender = resolve)),
    );
    const { onError } = renderSheet();

    fireEvent.change(screen.getByPlaceholderText(en.create.mapsLinkPlaceholder), {
      target: { value: "https://maps.google.com/?cid=7" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.create.resolveLink }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(en.create.resolveFailed));
    expect(mockedApiFetch).not.toHaveBeenCalled();
    resolveRender("w-late");
  });

  it("without a sitekey no widget renders and the resolve posts no token", async () => {
    mockedApiFetch.mockResolvedValue(POI_FIXTURE);
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText(en.create.mapsLinkPlaceholder), {
      target: { value: "https://maps.apple.com/?q=coffee" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.create.resolveLink }));
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalled());
    expect(mockedRenderWidget).not.toHaveBeenCalled();
    const body = JSON.parse(String(mockedApiFetch.mock.calls[0][1]?.body));
    expect(body).toEqual({ maps_share_url: "https://maps.apple.com/?q=coffee" });
  });
});

describe("provider workflow", () => {
  it("provider init runs on mount even while the search tab is hidden", async () => {
    const init = vi.fn(async () => {});
    mockedGetProviders.mockReturnValue([makeProvider({ id: "apple", init })]);
    renderSheet(); // default entryMode = "link"; the provider panel mounts hidden
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(searchPanel()).toHaveAttribute("hidden");
  });

  it("a rejected init surfaces searchFailed; a 401 init routes to the sign-in gate", async () => {
    mockedGetProviders.mockReturnValue([
      makeProvider({
        id: "apple",
        init: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    ]);
    const first = renderSheet({ initialProvider: "apple" });
    await waitFor(() => expect(first.onError).toHaveBeenCalledWith(en.create.searchFailed));
    expect(first.onRequireSignIn).not.toHaveBeenCalled();
    first.unmount();

    mockedGetProviders.mockReturnValue([
      makeProvider({
        id: "apple",
        init: vi.fn(async () => {
          throw new Error(UNAUTHORIZED);
        }),
      }),
    ]);
    const second = renderSheet({ initialProvider: "apple" });
    await waitFor(() => expect(second.onRequireSignIn).toHaveBeenCalled());
    expect(second.onError).not.toHaveBeenCalledWith(en.create.searchFailed);
  });

  it("selecting a candidate resolves it and forwards onSelectPOI with persist flag", async () => {
    const provider = makeProvider({ persistOnSelect: true });
    mockedGetProviders.mockReturnValue([provider]);
    const { onSelectPOI } = renderSheet({ initialProvider: "google" });

    const input = screen.getByPlaceholderText(en.create.searchPlaceholder);
    fireEvent.change(input, { target: { value: "blue" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(await screen.findByText("Blue Bottle"));

    await waitFor(() => expect(onSelectPOI).toHaveBeenCalledWith(POI_FIXTURE, true));
    expect(provider.resolve).toHaveBeenCalledWith(CANDIDATE);
  });
});
