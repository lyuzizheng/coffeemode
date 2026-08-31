import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileView } from "@/components/profile/profile-view";
import messages from "../../messages/en.json";

const pushMock = vi.fn();
const backMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    back: backMock,
    refresh: vi.fn(),
  }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("ProfileView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("renders anonymous gate when not authenticated", () => {
    render(
      <ProfileView
        initialProfile={null}
        initialStats={null}
        isAuthenticated={false}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Your cafes live here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Apple/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
  });

  it("renders authenticated profile with stats and tabs", () => {
    const mockProfile = {
      id: "user-1",
      displayName: "Coffee Lover",
      currentCity: "singapore",
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockStats = {
      cafesCount: 12,
      checkinsCount: 34,
    };

    render(
      <ProfileView
        initialProfile={mockProfile}
        initialStats={mockStats}
        isAuthenticated={true}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Coffee Lover")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My Check-ins" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My Coffee Map" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Favorites" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Search History" })).toBeInTheDocument();
  });

  it("mounts both checkins and cafes queries at view root and persists data across tab switches", async () => {
    const mockProfile = {
      id: "user-1",
      displayName: "Coffee Lover",
      currentCity: "singapore",
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/profile/checkins")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "c-1",
                cafeId: "cafe-1",
                cafeName: "Artisan Cafe",
                visitedAt: new Date().toISOString(),
                scores: { overall: 90 },
                likesCount: 3,
                cafeIsDeleted: false,
                notes: "Great coffee",
              },
            ],
            next_cursor: null,
          }),
        };
      }
      if (url.includes("/api/profile/cafes")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "cafe-1",
                name: "Artisan Cafe",
                cover: null,
                isCreation: true,
                lastVisitedAt: new Date().toISOString(),
                checkinsCount: 1,
              },
            ],
            next_cursor: null,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.fetch = fetchMock;

    render(
      <ProfileView
        initialProfile={mockProfile}
        initialStats={{ cafesCount: 1, checkinsCount: 1 }}
        isAuthenticated={true}
      />,
      { wrapper: Wrapper },
    );

    // Verify initial check-in renders from query
    await waitFor(() => {
      expect(screen.getByText("Artisan Cafe")).toBeInTheDocument();
    });

    // Both queries were triggered upon mount
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/profile/checkins"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/profile/cafes"));

    // Switch to My Coffee Map
    const mapTab = screen.getByRole("tab", { name: "My Coffee Map" });
    fireEvent.click(mapTab);
    expect(mapTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Created by me")).toBeInTheDocument();

    // Switch to Favorites
    const favoritesTab = screen.getByRole("tab", { name: "Favorites" });
    fireEvent.click(favoritesTab);
    expect(favoritesTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("No favorites yet")).toBeInTheDocument();

    // Switch back to Check-ins
    const checkinsTab = screen.getByRole("tab", { name: "My Check-ins" });
    fireEvent.click(checkinsTab);
    expect(checkinsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Artisan Cafe")).toBeInTheDocument();
  });
});
