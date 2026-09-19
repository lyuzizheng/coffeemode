import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { CafeAppShell } from "@/app/cafes/[id]/cafe-app-shell";
import messages from "../../messages/en.json";

/**
 * The app tree is mocked to a marker — CafeAppShell's own contract is the
 * handoff: which props the map app gets (cafe at FULL, card suppressed,
 * cafe coordinates as the center) and that the SSR shell fades out and
 * unmounts once the app is live.
 */
const homeProps = { current: null as Record<string, unknown> | null };
vi.mock("@/components/onboarding/onboarding-home", () => ({
  OnboardingHome: (props: Record<string, unknown> & { children?: ReactNode }) => {
    homeProps.current = props;
    return <div data-testid="map-app">{props.children}</div>;
  },
}));
vi.mock("@/components/map/map-surface", () => ({
  MapSurface: () => <div data-testid="map-surface" />,
}));
vi.mock("@/components/cafe/cafe-creation-sheet", () => ({
  CafeCreationTrigger: () => null,
}));

const CAFE_ID = "550e8400-e29b-41d4-a716-446655440000";
const CAFE_CENTER = { lat: 1.29027, lng: 103.851959 };

function renderShell() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CafeAppShell
        cafeId={CAFE_ID}
        cafeCenter={CAFE_CENTER}
        city="singapore"
        detectedCity={null}
        isAuthenticated={false}
        serverOnboarded={false}
        mapkitConfigured={false}
      >
        <div data-testid="ssr-shell">shell content</div>
      </CafeAppShell>
    </NextIntlClientProvider>,
  );
}

describe("CafeAppShell (DG124 hydration handoff)", () => {
  it("mounts the map app with the cafe at FULL and the card suppressed", () => {
    renderShell();
    expect(screen.getByTestId("map-app")).toBeInTheDocument();
    expect(screen.getByTestId("map-surface")).toBeInTheDocument();
    expect(homeProps.current).toMatchObject({
      initialCafeId: CAFE_ID,
      initialSnap: "full",
      suppressCard: true,
      initialCenter: CAFE_CENTER,
      city: "singapore",
    });
  });

  it("fades the SSR shell out and unmounts it after the transition", async () => {
    renderShell();
    const shell = screen.getByTestId("ssr-shell");
    // Mounted: the overlay is already fading (opacity-0, inert).
    expect(shell.parentElement).toHaveClass("opacity-0");
    await waitFor(
      () => expect(screen.queryByTestId("ssr-shell")).not.toBeInTheDocument(),
      { timeout: 2000 },
    );
    // The app stays — the shell was only ever an overlay.
    expect(screen.getByTestId("map-app")).toBeInTheDocument();
  });
});
