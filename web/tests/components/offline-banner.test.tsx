import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "@/components/offline-banner";
import en from "@/messages/en.json";

vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: vi.fn(),
}));

import { useNetworkStatus } from "@/hooks/use-network-status";

function renderBanner(isOffline: boolean) {
  vi.mocked(useNetworkStatus).mockReturnValue({
    isOffline,
    isOnline: !isOffline,
    state: isOffline ? "offline" : "online",
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
    renderBanner(true);
    // aria-live regions are excluded from accessible-name computation, so
    // assert on the live region's text content directly.
    expect(screen.getByRole("status")).toHaveTextContent(/connection is unstable/i);
  });

  it("renders nothing when online", () => {
    renderBanner(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
