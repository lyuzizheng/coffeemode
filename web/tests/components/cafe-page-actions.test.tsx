import { describe, expect, it, vi, beforeEach } from "vitest";
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
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
const LIVE_CHECKIN = {
  id: CHECKIN,
  scores: { wifi: 80, overall: 90 },
  max_stay: "3h",
  note: "Corner seat",
  visited_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), // past the DG64 window
};

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

function mockProbe(body: () => Promise<unknown>, status = 200) {
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/checkins/last")) {
      return Promise.resolve({ ok: status === 200, status, json: body });
    }
    if (init?.method === "PATCH" || init?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

describe("CafePageActions (DG72 edit entry)", () => {
  beforeEach(() => {
    mockProbe(async () => ({ checkin: null, revisitWindowHours: 24 }));
  });

  it("keeps the conversion block — Check in, Navigate, Share — with no edit row when the viewer has no live check-in", async () => {
    renderActions();
    expect(screen.getByRole("button", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Navigate" })).toBeInTheDocument();
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/checkins/last"));
    });
    expect(screen.queryByRole("button", { name: /Edit your check-in/ })).not.toBeInTheDocument();
  });

  it("hides the edit row for anonymous viewers (probe 401)", async () => {
    mockProbe(async () => ({}), 401);
    renderActions();
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/checkins/last"));
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Edit your check-in/ })).not.toBeInTheDocument();
    });
  });

  it("shows the edit row with a live check-in and opens the drawer prefilled in edit mode", async () => {
    mockProbe(async () => ({ checkin: LIVE_CHECKIN, revisitWindowHours: 24 }));
    renderActions();

    const row = await screen.findByRole("button", { name: /Edit your check-in/ });
    fireEvent.click(row);

    // Edit chrome, prefilled from the probe — not a blank create form.
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

  it("saves through PATCH on the probed check-in id", async () => {
    mockProbe(async () => ({ checkin: LIVE_CHECKIN, revisitWindowHours: 24 }));
    renderActions();

    fireEvent.click(await screen.findByRole("button", { name: /Edit your check-in/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/checkins/${CHECKIN}`,
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("drops the edit row once the live check-in is deleted from the drawer", async () => {
    let live = true;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/checkins/last")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ checkin: live ? LIVE_CHECKIN : null, revisitWindowHours: 24 }),
        });
      }
      if (init?.method === "DELETE") {
        live = false;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    renderActions();

    fireEvent.click(await screen.findByRole("button", { name: /Edit your check-in/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete check-in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Edit your check-in/ })).not.toBeInTheDocument();
    });
  });
});
