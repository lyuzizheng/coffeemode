import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DesktopSidebar } from "@/components/discovery/desktop-sidebar";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import messages from "../../messages/en.json";

/**
 * BRAWUKA-511: the add-cafe action must stay reachable at scroll-top.
 * The masthead's copy is visibility:hidden while the frontispiece is open,
 * so the panel carries its own CTA — exactly one "Add a cafe" button is
 * in the a11y tree in the expanded state.
 */

const controller: DiscoveryController = {
  selectedCafeId: null,
  snap: "peek",
  select: vi.fn(),
  snapTo: vi.fn(),
  close: vi.fn(),
  handleMissingCafe: vi.fn(),
  registerCardRef: vi.fn(),
  detailHeadingRef: vi.fn(),
};

const cafe: CafeSummary = {
  id: "01921a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b",
  name: "Kiosk Roastery",
  lat: 35.66,
  lng: 139.7,
  address: "1-2-3 Shibuya",
  city: "Tokyo",
  tz: "Asia/Tokyo",
  opening_hours: null,
  price_range: 2,
  work_stats: emptyWorkStats(),
  cover: null,
  distance_m: 320,
  maintained_by_service: false,
};

function renderSidebar() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DesktopSidebar
        contentVisible
        isLoading={false}
        isError={false}
        cafes={[cafe]}
        onRetry={vi.fn()}
        addCafe={<button type="button">Add a cafe</button>}
        controller={controller}
      />
    </NextIntlClientProvider>,
  );
}

describe("DesktopSidebar frontispiece (BRAWUKA-511)", () => {
  it("keeps exactly one add-cafe affordance in the a11y tree at scroll-top", () => {
    renderSidebar();
    // Masthead + frontispiece both mount the slot; the masthead copy is
    // visibility:hidden at scroll-top, so only the panel's CTA is reachable.
    const buttons = screen.getAllByRole("button", { name: "Add a cafe" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeVisible();
  });

  it("renders the manifesto inside the expanded frontispiece", () => {
    renderSidebar();
    expect(screen.getByText(messages.discovery.brand_intro)).toBeInTheDocument();
  });
});
