import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as HeroUI from "@heroui/react";
import { ProfileView } from "@/components/profile/profile-view";
import { WORK_DIMS } from "@/lib/stats/work-stats";
import messages from "../../messages/en.json";
import zhMessages from "../../messages/zh.json";

const pushMock = vi.fn();
const backMock = vi.fn();
const toastSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    back: backMock,
    refresh: vi.fn(),
  }),
  usePathname: () => "/profile",
}));

// Toasts are asserted via spy — HeroUI renders them into a portal outside
// the tree under test.
vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof HeroUI>();
  return { ...actual, toast: (...args: unknown[]) => toastSpy(...args) };
});

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


function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
      lastLocation: null,
      onboarded: false,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      showPublicIdentity: false,
      publicHandle: null,
      identityConsentedAt: null,
      publicHandleChangedAt: null,
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


  it("defers the cafes query until the map tab is first visited", async () => {
    const mockProfile = {
      id: "user-1",
      displayName: "Coffee Lover",
      currentCity: "singapore",
      lastLocation: null,
      onboarded: false,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      showPublicIdentity: false,
      publicHandle: null,
      identityConsentedAt: null,
      publicHandleChangedAt: null,
    };

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/profile/checkins")) {
        return jsonResponse(200, {
            items: [
              {
                id: "c-1",
                cafe_id: "cafe-1",
                cafe_name: "Artisan Cafe",
                visited_at: new Date().toISOString(),
                scores: { overall: 90 },
                likes_count: 3,
                cafe_is_deleted: false,
                notes: "Great coffee",
              },
            ],
            next_cursor: null,
          });
      }
      if (url.includes("/api/profile/cafes")) {
        return jsonResponse(200, {
            items: [
              {
                id: "cafe-1",
                name: "Artisan Cafe",
                cover: null,
                is_creation: true,
                last_visited_at: new Date().toISOString(),
                checkins_count: 1,
              },
            ],
            next_cursor: null,
          });
      }
      return jsonResponse(200, {});
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

    // BRAWUKA-281 P2: the cafes query stays disabled until the map tab is
    // first visited — a plain profile load skips one paginated DB query.
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/profile/checkins"), undefined);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/profile/cafes"), undefined);

    // Switch to My Coffee Map — the cafes query fires exactly once.
    const mapTab = screen.getByRole("tab", { name: "My Coffee Map" });
    fireEvent.click(mapTab);
    expect(mapTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/profile/cafes"), undefined);
    });
    await waitFor(() => {
      expect(screen.getByText("Created by me")).toBeInTheDocument();
    });

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

  it("keeps the name editor open and toasts when the save fails", async () => {
    const mockProfile = {
      id: "user-1",
      displayName: "Coffee Lover",
      currentCity: "singapore",
      lastLocation: null,
      onboarded: false,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      showPublicIdentity: false,
      publicHandle: null,
      identityConsentedAt: null,
      publicHandleChangedAt: null,
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/profile") {
        return jsonResponse(500, {});
      }
      return jsonResponse(200, { items: [], next_cursor: null });
    }) as unknown as typeof fetch;

    render(
      <ProfileView
        initialProfile={mockProfile}
        initialStats={{ cafesCount: 1, checkinsCount: 1 }}
        isAuthenticated={true}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Your name" }));
    const input = screen.getByPlaceholderText("Your name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith("Couldn't save — try again?", { timeout: 4000 });
    });
    // The draft survives so the user can retry instead of retyping.
    expect(screen.getByPlaceholderText("Your name")).toHaveValue("New Name");
  });

  it("keeps the city selector open and toasts when the save fails", async () => {
    const mockProfile = {
      id: "user-1",
      displayName: "Coffee Lover",
      currentCity: "singapore",
      lastLocation: null,
      onboarded: false,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      showPublicIdentity: false,
      publicHandle: null,
      identityConsentedAt: null,
      publicHandleChangedAt: null,
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/profile") {
        return jsonResponse(500, {});
      }
      return jsonResponse(200, { items: [], next_cursor: null });
    }) as unknown as typeof fetch;

    render(
      <ProfileView
        initialProfile={mockProfile}
        initialStats={{ cafesCount: 1, checkinsCount: 1 }}
        isAuthenticated={true}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: /Singapore/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tokyo" }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith("Couldn't save — try again?", { timeout: 4000 });
    });
    // Selector stays open so a retry is one tap.
    expect(screen.getByRole("button", { name: "Tokyo" })).toBeInTheDocument();
  });
});

/**
 * BRAWUKA-218: the check-in card chips must render the catalog dimension
 * names (`discovery.dims.*`, the same vocabulary the feed card uses), never
 * the raw `scores` object keys (`temp`, `wifi`, …).
 */
describe("ProfileView check-in score chips", () => {
  const scores = { wifi: 82, outlets: 78, seats: 75, temp: 88, coffee: 92, overall: 88 };

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/profile/checkins")) {
        return jsonResponse(200, {
            items: [
              {
                id: "chk-1",
                cafe_id: "cafe-1",
                cafe_name: "Nanyang Roastery",
                cafe_city: "singapore",
                cafe_is_deleted: false,
                visited_at: "2026-09-03T04:00:00.000Z",
                scores,
                max_stay: "3h",
                likes_count: 12,
                notes: null,
                photos: [],
                is_creation: false,
              },
            ],
            next_cursor: null,
          });
      }
      return jsonResponse(200, { items: [], next_cursor: null });
    }) as unknown as typeof fetch;
  });

  function renderProfile(locale: "en" | "zh") {
    return render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? messages : zhMessages}
      >
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProfileView
            initialProfile={{
              id: "user-1",
              displayName: "Coffee Lover",
              avatarUrl: null,
              currentCity: "singapore",
      lastLocation: null,
      onboarded: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              showPublicIdentity: false,
              publicHandle: null,
              identityConsentedAt: null,
              publicHandleChangedAt: null,
            }}
            initialStats={{ cafesCount: 1, checkinsCount: 1 }}
            isAuthenticated
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  }

  it.each([
    ["en", ["Temperature 88", "Wifi 82", "Seats 75", "Coffee 92", "Outlets 78", "Overall 88"]],
    ["zh", ["温度 88", "Wi-Fi 82", "座位 75", "咖啡 92", "插座 78", "综合体验 88"]],
  ] as const)("renders translated dimension names in %s", async (locale, chips) => {
    renderProfile(locale);

    await waitFor(() => expect(screen.getByText("Nanyang Roastery")).toBeInTheDocument());
    for (const chip of chips) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
    for (const dim of WORK_DIMS) {
      expect(screen.queryByText(new RegExp(`^${dim} \\d+$`))).toBeNull();
    }
  });
});
