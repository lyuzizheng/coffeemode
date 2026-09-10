import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CafePageActions } from "@/app/cafes/[id]/cafe-page-actions";
import messages from "../../messages/en.json";
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

function renderActions() {
  return render(
    <CafePageActions
      cafe={{ name: "Kiosk", lat: 1.3521, lng: 103.8198 }}
      cafeId={CAFE}
      shareUrl="https://coffeemode.example/cafes/x"
    />,
    { wrapper: Wrapper },
  );
}

function mockFetch() {
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.startsWith("/api/checkins/last")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ checkin: null, revisitWindowHours: 24 }),
      });
    }
    if (init?.method === "PATCH" || init?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

// Owner verdict (BRAWUKA-120, 2026-09-10): the cafe detail page carries no
// edit entry — editing lives on the feed card overflow menu and the profile
// history list (DG72). These tests pin the conversion-only action block.
describe("CafePageActions (no edit entry per owner verdict)", () => {
  beforeEach(() => {
    mockFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the conversion block — Check in, Navigate, Share — and nothing else", () => {
    renderActions();
    expect(screen.getByRole("button", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Navigate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit your check-in/ })).not.toBeInTheDocument();
  });

  it("never probes /api/checkins/last on mount — the drawer probes on open (DG64)", async () => {
    renderActions();
    // Let any mount-time queries settle.
    await waitFor(() => expect(screen.getByRole("button", { name: "Check in" })).toBeInTheDocument());
    const { promise: settled, resolve: settle } = Promise.withResolvers<void>();
    setTimeout(settle, 50);
    await settled;
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/checkins/last"),
    );
  });

  it("opens the create drawer from the Check-in CTA", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    expect(await screen.findByRole("dialog", { name: "Check in" })).toBeInTheDocument();
  });
});
