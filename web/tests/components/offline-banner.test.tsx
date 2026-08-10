import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "@/components/offline-banner";
import en from "@/messages/en.json";

vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: vi.fn(),
}));

import { useNetworkStatus } from "@/hooks/use-network-status";

function renderWithState(state: "online" | "offline" | "unknown") {
  vi.mocked(useNetworkStatus).mockReturnValue({
    isOffline: state === "offline",
    isOnline: state === "online",
    state,
    lastOnline: null,
  });
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OfflineBanner />
    </NextIntlClientProvider>,
  );
}

describe("OfflineBanner", () => {
  it("renders the translated banner when offline", () => {
    renderWithState("offline");
    // aria-live regions are excluded from accessible-name computation, so
    // assert on the live region's text content directly.
    expect(screen.getByRole("status")).toHaveTextContent(/connection is unstable/i);
  });

  it("renders nothing when online", () => {
    renderWithState("online");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing while the network state is still unknown (SSR/hydration)", () => {
    renderWithState("unknown");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
