import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinFeed } from "@/components/discovery/checkin-feed";
import messages from "../../messages/en.json";
import type { PublicCheckIn } from "@/types/checkins";
// The real hook pings /api/health on an interval through a module-level
// singleton; the fetch mocks below would flip tests offline mid-run.
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));
// IndexedDB is not available in jsdom — the DG66 draft store is mocked.
vi.mock("@/lib/checkin/pending-checkin", () => ({
  savePendingCheckin: vi.fn().mockResolvedValue(undefined),
  loadPendingCheckin: vi.fn().mockResolvedValue(null),
  clearPendingCheckin: vi.fn().mockResolvedValue(undefined),
}));

const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function card(id: string, owned: boolean, note: string): PublicCheckIn {
  return {
    id,
    scores: { wifi: 80, overall: 90 },
    max_stay: "3h",
    note,
    photos: [],
    likes_count: 0,
    liked_by_viewer: false,
    owned_by_viewer: owned,
    visited_at: "2026-08-20T10:00:00.000Z",
    author: null,
  };
}

const OWN_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31";
const OTHER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a32";

function mockFeed() {
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.startsWith(`/api/cafes/${CAFE}/checkins`)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          checkins: [card(OWN_ID, true, "Corner seat"), card(OTHER_ID, false, "Great espresso")],
          nextCursor: null,
        }),
      });
    }
    if (init?.method === "PATCH" || init?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

function renderFeed() {
  return render(
    <CheckinFeed cafeId={CAFE} cafeName="Kiosk" onMissingCafe={() => {}} onCheckIn={() => {}} />,
    { wrapper: Wrapper },
  );
}

// DG72 feed-card edit entry (owner verdict BRAWUKA-120): only the viewer's
// own cards expose the overflow menu, opening the drawer prefilled in edit
// mode. jsdom has no IntersectionObserver — the paging sentinel is stubbed.
describe("CheckinFeed own-card edit entry", () => {
  beforeEach(() => {
    mockFeed();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("shows the overflow menu only on the viewer's own card", async () => {
    renderFeed();
    expect(await screen.findByText("Corner seat")).toBeInTheDocument();
    expect(screen.getByText("Great espresso")).toBeInTheDocument();
    const menus = screen.queryAllByRole("button", { name: "More actions for this check-in" });
    expect(menus).toHaveLength(1);
  });

  it("opens the drawer prefilled in edit mode from the own-card menu", async () => {
    renderFeed();
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for this check-in" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit your check-in" }));

    // Edit chrome, prefilled from the feed DTO — not a blank create form.
    expect(await screen.findByRole("dialog", { name: "Edit check-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete check-in" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What should the next nomad know?")).toHaveValue(
      "Corner seat",
    );
    expect(screen.getByRole("slider", { name: "Overall experience" })).toHaveAttribute(
      "aria-valuenow",
      "90",
    );
  });

  it("dismisses the menu on Escape", async () => {
    renderFeed();
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for this check-in" }),
    );
    expect(await screen.findByRole("menuitem", { name: "Edit your check-in" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "Edit your check-in" }),
      ).not.toBeInTheDocument();
    });
  });
});
