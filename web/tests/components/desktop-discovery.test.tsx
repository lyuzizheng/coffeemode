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
      >
        <div data-testid="landing-content">
          <h1>Marketing Landing Page</h1>
        </div>
      </DesktopDiscovery>,
      { wrapper: Wrapper },
    );

    // Sidebar discovery region exists
    expect(screen.getByRole("region", { name: messages.discovery.sheet_aria })).toBeInTheDocument();
    expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();

    // Children landing content is rendered and not covered
    expect(screen.getByTestId("landing-content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marketing Landing Page" })).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: messages.discovery.sheet_aria })).toBeInTheDocument();
    expect(screen.getByText("Common Man Coffee Roasters")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-content")).not.toBeInTheDocument();
  });
});
