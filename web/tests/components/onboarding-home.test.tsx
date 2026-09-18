import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { OnboardingHome } from "@/components/onboarding/onboarding-home";
import { isGeolocationDenied, requestPosition } from "@/lib/geolocation";
import { readOnboardingState } from "@/lib/onboarding-store";
import { LAUNCH_CITIES } from "@/lib/cities";
import messages from "../../messages/en.json";

const toastMock = vi.fn();
vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast: (...args: unknown[]) => toastMock(...args) };
});

vi.mock("@/lib/geolocation", () => ({
  isGeolocationDenied: vi.fn().mockResolvedValue(false),
  requestPosition: vi.fn(),
}));

// DiscoveryHome is the surface under test elsewhere; here it only needs to
// render the overlay slot and expose the center it was given.
const lastCenter = { current: null as { lat: number; lng: number } | null };
vi.mock("@/components/discovery/discovery-home", () => ({
  DiscoveryHome: ({
    center,
    mapOverlay,
    children,
  }: {
    center: { lat: number; lng: number };
    mapOverlay?: ReactNode;
    children?: ReactNode;
  }) => {
    lastCenter.current = center;
    return (
      <div data-testid="discovery">
        {children}
        {mapOverlay}
      </div>
    );
  },
}));

const singapore = LAUNCH_CITIES[0];
const tokyo = LAUNCH_CITIES[1];

function renderHome(props?: Partial<Parameters<typeof OnboardingHome>[0]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OnboardingHome
        detectedCity={tokyo}
        initialCenter={singapore.center}
        isAuthenticated={false}
        serverOnboarded={false}
        addCafe={null}
        {...props}
      >
        <div>surface</div>
      </OnboardingHome>
    </NextIntlClientProvider>,
  );
}

describe("OnboardingHome (DG114–DG123)", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });
    vi.clearAllMocks();
    lastCenter.current = null;
    vi.mocked(isGeolocationDenied).mockResolvedValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ city: null }) }));
  });

  it("shows the card on a first visit with the detected-city line", async () => {
    renderHome();
    expect(await screen.findByText("Find a cafe you can actually work in")).toBeInTheDocument();
    expect(screen.getByText("Looks like you're in Tokyo")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Skip lands on the IP-detected city and never returns (DG116)", async () => {
    renderHome();
    fireEvent.click(await screen.findByText("Skip for now"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(readOnboardingState()).toMatchObject({
      onboarded: true,
      currentCity: "tokyo",
    });
    expect(lastCenter.current).toEqual(tokyo.center);
    expect(screen.getByRole("button", { name: "Locate me" })).toBeInTheDocument();
  });

  it("does not interrupt returning anonymous visitors", async () => {
    store["coffeemode:onboarding:v1"] = JSON.stringify({
      onboarded: true,
      currentCity: "seoul",
    });
    renderHome();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Locate me" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Stored city wins over the server default center.
    expect(lastCenter.current).toEqual(LAUNCH_CITIES[2].center);
  });

  it("never shows the card when profiles.onboarded is set (DG122)", async () => {
    renderHome({ serverOnboarded: true, isAuthenticated: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Locate me" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("suppresses the card on deep-link arrivals (DG124)", async () => {
    renderHome({ suppressCard: true, initialCafeId: "550e8400-e29b-41d4-a716-446655440000" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Locate me" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deep-link arrivals keep the server center over a stored city (DG124)", async () => {
    // A returning anonymous visitor has a stored city — the linked cafe's
    // coordinates must still win so the map focuses the linked cafe.
    store["coffeemode:onboarding:v1"] = JSON.stringify({
      onboarded: true,
      currentCity: "seoul",
    });
    renderHome({ suppressCard: true, initialCafeId: "550e8400-e29b-41d4-a716-446655440000" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Locate me" })).toBeInTheDocument(),
    );
    expect(lastCenter.current).toEqual(singapore.center);
  });

  it("the account chip rides the mapOverlay slot in every phase (BRAWUKA-318)", async () => {
    // Signed-out, card visible: sign-in affordance + theme toggle.
    renderHome();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(screen.getByRole("button", { name: /Theme/ })).toBeInTheDocument();
  });

  it("the account chip shows the profile initial when signed in", async () => {
    renderHome({ isAuthenticated: true, serverOnboarded: true, accountInitial: "J" });
    const link = await screen.findByRole("link", { name: "Profile" });
    expect(link).toHaveAttribute("href", "/profile");
    expect(link).toHaveTextContent("J");
  });

  it("grant recenters on the user and resolves the city server-side", async () => {
    vi.mocked(requestPosition).mockResolvedValueOnce({ ok: true, lat: 1.29, lng: 103.85 });
    renderHome();
    fireEvent.click(await screen.findByText("Enable location"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(lastCenter.current).toEqual({ lat: 1.29, lng: 103.85 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/onboarding/locate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(readOnboardingState()).toMatchObject({
      onboarded: true,
      lastLocation: { lat: 1.29, lng: 103.85 },
    });
  });

  it("denial keeps the card with the picker-focused recovery state (DG117)", async () => {
    vi.mocked(requestPosition).mockResolvedValueOnce({ ok: false, reason: "denied" });
    renderHome();
    fireEvent.click(await screen.findByText("Enable location"));
    expect(await screen.findByText("Location is off — pick your city")).toBeInTheDocument();
    expect(screen.getByText("Use Tokyo")).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith("Location access was declined", expect.anything());
    // "Use {city}" commits the picker's city.
    fireEvent.click(screen.getByText("Use Tokyo"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(readOnboardingState()).toMatchObject({ onboarded: true, currentCity: "tokyo" });
  });

  it("a denied locate-button tap shows the one-time settings toast (DG117)", async () => {
    renderHome({ serverOnboarded: true, isAuthenticated: true });
    const button = await screen.findByRole("button", { name: "Locate me" });
    vi.mocked(isGeolocationDenied).mockResolvedValue(true);
    fireEvent.click(button);
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        "Location is off — enable it in system settings",
        expect.anything(),
      ),
    );
    // Second tap: no repeat toast.
    toastMock.mockClear();
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 20));
    expect(toastMock).not.toHaveBeenCalled();
  });
});
