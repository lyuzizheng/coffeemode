import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as HeroUI from "@heroui/react";
import { CafeOwnerControls } from "@/components/cafe/cafe-owner-controls";
import messages from "../../messages/en.json";

const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// Toasts are asserted via spy — HeroUI renders them into a portal outside
// the tree under test.
const toastSpy = vi.fn();
vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof HeroUI>();
  return { ...actual, toast: (...args: unknown[]) => toastSpy(...args) };
});

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

function renderControls(props?: Partial<Parameters<typeof CafeOwnerControls>[0]>) {
  return render(
    <CafeOwnerControls
      cafeId={CAFE}
      initialVisibility="public"
      hasCheckins
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("CafeOwnerControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the delete entry on an empty shell but keeps the visibility switch", () => {
    globalThis.fetch = vi.fn();
    renderControls({ hasCheckins: false });
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("PATCHes visibility private and refreshes the SSR badge", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return jsonResponse(200, { ok: true, id: CAFE, visibility: "private" });
      return jsonResponse(200, {});
    });
    globalThis.fetch = fetchMock;

    renderControls();
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/cafes/${CAFE}/visibility`,
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ visibility: "private" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("rolls the switch back and toasts when the PATCH fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      jsonResponse(500, { error: "internal_error" }),
    );

    renderControls();
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toggle).not.toBeChecked();
  });

  it("confirms with the shell copy, then sends a bare DELETE (no confirm)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return jsonResponse(200, { ok: true, id: CAFE, removed_checkins: 1, owner_transferred: false, shell: true });
      }
      return jsonResponse(200, {});
    });
    globalThis.fetch = fetchMock;

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // Shell pre-confirm copy (DG146): check-in removed, cafe stays empty.
    expect(
      screen.getByText(/the cafe stays as an empty shell/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/cafes/${CAFE}`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    // DG146: the first DELETE is unconfirmed — only a bare request can
    // surface 403 cafe_has_other_checkins; confirm:true would silently
    // hand the cafe off under the wrong copy.
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("maps 403 cafe_has_other_checkins to the handoff copy and retries confirmed", async () => {
    let deleteCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteCalls += 1;
        // The real API only returns this 403 for an UNCONFIRMED delete.
        if (deleteCalls === 1) {
          return jsonResponse(403, {
            error: "cafe_has_other_checkins",
            n: 3,
          });
        }
        return jsonResponse(200, { ok: true, id: CAFE, removed_checkins: 1, owner_transferred: true, shell: false });
      }
      return jsonResponse(200, {});
    });
    globalThis.fetch = fetchMock;

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // The 403 upgrades the same confirm surface to the handoff copy with n.
    expect(
      await screen.findByText(/has 3 check-ins from others/i),
    ).toBeInTheDocument();

    // First call was bare; only the handoff retry carries confirm:true.
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete my check-in" }));

    await waitFor(() => expect(deleteCalls).toBe(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ confirm: true });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("keeps machine codes out of the UI on unexpected failures", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return jsonResponse(500, { error: "internal_error" });
      }
      return jsonResponse(200, {});
    });

    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(
      "Couldn't delete — try again?",
      expect.anything(),
    ));
    expect(screen.queryByText(/internal_error/)).not.toBeInTheDocument();
  });
});
