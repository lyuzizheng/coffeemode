import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { DesktopDiscovery } from "@/components/discovery/desktop-discovery";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
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
