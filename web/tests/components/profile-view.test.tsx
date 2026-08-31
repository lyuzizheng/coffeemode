import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("switches tabs when tab buttons are clicked", () => {
    const mockProfile = {
      id: "user-1",
      displayName: "Coffee Lover",
      currentCity: "singapore",
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <ProfileView
        initialProfile={mockProfile}
        initialStats={{ cafesCount: 5, checkinsCount: 10 }}
        isAuthenticated={true}
      />,
      { wrapper: Wrapper },
    );

    const favoritesTab = screen.getByRole("tab", { name: "Favorites" });
    fireEvent.click(favoritesTab);
    expect(favoritesTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("No favorites yet")).toBeInTheDocument();

    const historyTab = screen.getByRole("tab", { name: "Search History" });
    fireEvent.click(historyTab);
    expect(historyTab).toHaveAttribute("aria-selected", "true");
  });
});
