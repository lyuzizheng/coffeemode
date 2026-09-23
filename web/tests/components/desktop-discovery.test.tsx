import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prefersReducedMotion } from "motion-dom";
import type { ReactNode } from "react";
import { DesktopDiscovery } from "@/components/discovery/desktop-discovery";
import type { DiscoverySearch } from "@/components/discovery/use-discovery-search";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import { EMPTY_FILTERS } from "@/lib/search/search-filters";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import messages from "../../messages/en.json";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}


const mockCafe: CafeSummary = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Common Man Coffee Roasters",
  lat: 1.29027,
  lng: 103.851959,
  address: "22 Martin Rd",
  city: "singapore",
  tz: "Asia/Singapore",
  opening_hours: null,
  price_range: 2,
  cover: "/card/test.webp",
  distance_m: 250,
  maintained_by_service: false,
  work_stats: {
    ...emptyWorkStats(),
    n_users: 1,
    n_checkins: 1,
    composite_score: 85,
    experience_score: 88,
    dims: {
      ...emptyWorkStats().dims,
      wifi: { sum: 80, n: 1 },
    },
    policies: {
      max_stay: { "2h": 1 },
    },
  },
};

function createMockController(overrides?: Partial<DiscoveryController>): DiscoveryController {
  return {
    selectedCafeId: null,
    snap: "peek",
    select: vi.fn(),
    snapTo: vi.fn(),
    close: vi.fn(),
    handleMissingCafe: vi.fn(),
    registerCardRef: vi.fn(),
    detailHeadingRef: vi.fn(),
    ...overrides,
  };
}

describe("DesktopDiscovery container partitioning (issue #246)", () => {
  it("renders discovery columns alongside children in a partitioned flex container", () => {
    const controller = createMockController();
    render(
      <DesktopDiscovery
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
        showColumns
      >
        <div data-testid="landing-content">
          <h1>Marketing Landing Page</h1>
        </div>
      </DesktopDiscovery>,
      { wrapper: Wrapper },
    );

    // Sidebar discovery region exists
    const region = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    expect(region).toBeInTheDocument();
    expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();

    // Children landing content is rendered and not covered
    const landing = screen.getByTestId("landing-content");
    expect(landing).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marketing Landing Page" })).toBeInTheDocument();

    // Structural contract (#275): the region is sticky in-flow (never the old
    // fixed overlay), CSS-gated below lg, and shares one flex parent with the
    // landing subtree — a regression to the fixed overlay must fail here.
    expect(region.className).toContain("sticky");
    expect(region.className).not.toContain("fixed");
    expect(region.className).toContain("hidden");
    expect(region.className).toContain("lg:flex");
    expect(region.parentElement).toContainElement(landing);
  });

  it("keeps the sidebar shell mounted with skeletons when column content is gated (#275 SSR contract)", () => {
    const controller = createMockController();
    render(
      <DesktopDiscovery
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
        showColumns={false}
      >
        <div data-testid="landing-content" />
      </DesktopDiscovery>,
      { wrapper: Wrapper },
    );

    // Shell (region) renders even with content gated — SSR reserves the
    // column; only the interactive list/detail wait for mount.
    expect(screen.getByRole("region", { name: messages.discovery.sheet_aria })).toBeInTheDocument();
    expect(screen.queryByText("Common Man Coffee Roasters")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-content")).toBeInTheDocument();
  });

  it("renders standalone discovery columns when no children are passed", () => {
    const controller = createMockController();
    render(
      <DesktopDiscovery
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: Wrapper },
    );

    const region = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    expect(region).toBeInTheDocument();
    // Standalone (map-surface) mode stays a fixed overlay.
    expect(region.className).toContain("fixed");
    expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-content")).not.toBeInTheDocument();
  });
});

describe("DesktopDiscovery sidebar error branch (BRAWUKA-231)", () => {
  it("renders inline error with Retry instead of the empty state when the cafes query fails", () => {
    const onRetry = vi.fn();
    render(
      <DesktopDiscovery
        controller={createMockController()}
        cafes={[]}
        isLoading={false}
        isError
        onRetry={onRetry}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load nearby cafes");
    expect(screen.queryByText("No cafes nearby yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty state for a genuine empty result (no error)", () => {
    render(
      <DesktopDiscovery
        controller={createMockController()}
        cafes={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("No cafes nearby yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the loaded list when a refetch fails (previous content stays)", () => {
    render(
      <DesktopDiscovery
        controller={createMockController()}
        cafes={[mockCafe]}
        isLoading={false}
        isError
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DesktopDiscovery dual-state sidebar (BRAWUKA-506)", () => {
  /** Stateful stand-in for `useDiscoverySearch` — the sidebar only needs
   * the contract's shape; query changes flip `searchActive` like the hook. */
  function makeSearch(query: string, setQuery: (q: string) => void): DiscoverySearch {
    return {
      externalSources: { google: true, apple: false },
      mapkitConfigured: false,
      query,
      onQueryChange: setQuery,
      filters: EMPTY_FILTERS,
      onFiltersChange: () => {},
      onCityChange: () => {},
      searchActive: query.trim().length > 0,
      onSelectResult: vi.fn(),
      onExternalSearch: vi.fn(),
    };
  }

  function SearchHarness({ controller }: { controller: DiscoveryController }) {
    const [query, setQuery] = useState("");
    return (
      <DesktopDiscovery
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
        search={makeSearch(query, setQuery)}
      />
    );
  }

  const searchProp = makeSearch("", () => {});

  function renderSidebar(controllerOverrides?: Partial<DiscoveryController>) {
    return render(
      <DesktopDiscovery
        controller={createMockController(controllerOverrides)}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
        search={searchProp}
      />,
      { wrapper: Wrapper },
    );
  }

  it("renders the brand frontispiece expanded at scroll-top", () => {
    renderSidebar();
    // Frontispiece: eyebrow + wordmark + manifesto intro, centered.
    expect(screen.getByText(messages.onboarding.field_guide_mark)).toBeInTheDocument();
    expect(screen.getByText(messages.discovery.brand_intro)).toBeInTheDocument();
    // The index still renders below the panel.
    expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();
  });

  it("collapses the frontispiece when a cafe is selected", async () => {
    renderSidebar({ selectedCafeId: mockCafe.id });
    const intro = screen.getByText(messages.discovery.brand_intro);
    // The panel's visibility:hidden settles on the spring — the intro
    // becomes invisible once the collapse lands.
    await waitFor(() => expect(intro).not.toBeVisible());
  });
  it("collapses the frontispiece while a search query is active", async () => {
    render(<SearchHarness controller={createMockController()} />, { wrapper: Wrapper });
    const field = screen.getByRole("searchbox");
    fireEvent.change(field, { target: { value: "latte" } });
    const intro = screen.getByText(messages.discovery.brand_intro);
    await waitFor(() => expect(intro).not.toBeVisible());
  });

  it("renders only the compact masthead under prefers-reduced-motion", () => {
    // framer-motion latches the media query once into motion-dom's
    // prefersReducedMotion ref — flip the ref directly (matchMedia mocks
    // installed later never reach it).
    const previous = prefersReducedMotion.current;
    prefersReducedMotion.current = true;
    try {
      renderSidebar();
      expect(screen.queryByText(messages.discovery.brand_intro)).not.toBeInTheDocument();
      // Compact masthead + index remain.
      expect(screen.getByText(messages.discovery.tagline)).toBeInTheDocument();
      expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();
    } finally {
      prefersReducedMotion.current = previous;
    }
  });

  it("aligns the sidebar on the shared 16px gutter", () => {
    renderSidebar();
    // Row content shares the px-4 gutter (BRAWUKA-506 §2).
    const rowButton = screen.getByRole("button", { name: /Common Man Coffee Roasters/ });
    const rowBody = rowButton.firstElementChild as HTMLElement;
    expect(rowBody.className).toContain("px-4");
    expect(rowBody.className).toContain("py-3");
  });
});

describe("DesktopDiscovery Escape layering (BRAWUKA-576)", () => {
  function renderWithSelection() {
    const controller = createMockController({ selectedCafeId: mockCafe.id });
    render(
      <DesktopDiscovery
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: Wrapper },
    );
    return controller;
  }

  it("closes the detail column on a bare Escape", () => {
    const controller = renderWithSelection();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(controller.close).toHaveBeenCalledTimes(1);
  });

  it("leaves the detail column open when a higher layer consumed Escape", () => {
    const controller = renderWithSelection();
    // The contract menus/popovers follow: a document-level handler that
    // preventDefaults runs before the column's window listener.
    const consume = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    document.addEventListener("keydown", consume);
    try {
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(controller.close).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", consume);
    }
  });
});
