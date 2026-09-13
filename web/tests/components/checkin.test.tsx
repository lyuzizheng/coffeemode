import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinSlider } from "@/components/checkin/checkin-slider";
import { CheckinDrawer, resolveRevisitCheckin } from "@/components/checkin/checkin-drawer";
import { uploadPhoto } from "@/lib/images/client-upload";
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
// Toasts are asserted via spy — HeroUI renders them into a portal outside
// the tree under test.
const toastSpy = vi.fn();
vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast: (...args: unknown[]) => toastSpy(...args) };
});
// jsdom has no canvas/Image pipeline — photo uploads resolve instantly.
vi.mock("@/lib/images/client-upload", () => ({
  uploadPhoto: vi.fn().mockResolvedValue("img-uuid-1"),
}));

const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

function makeWrapper(queryClient?: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    // A fresh client per render keeps last-checkin cache from leaking
    // between tests; callers may inject a pre-seeded one instead.
    const client =
      queryClient ??
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

const Wrapper = makeWrapper();

function renderDrawer(
  props?: Partial<React.ComponentProps<typeof CheckinDrawer>>,
  queryClient?: QueryClient,
) {
  const onOpenChange = vi.fn();
  render(
    <CheckinDrawer
      isOpen
      onOpenChange={onOpenChange}
      cafeId={CAFE}
      cafeName="Kiosk"
      {...props}
    />,
    { wrapper: queryClient ? makeWrapper(queryClient) : Wrapper },
  );
  return onOpenChange;
}

describe("CheckinSlider", () => {
  it("announces an unset value via the notSet copy", () => {
    render(<CheckinSlider label="Wifi" value={null} onChange={() => {}} />, { wrapper: Wrapper });
    const slider = screen.getByRole("slider", { name: "Wifi" });
    expect(slider).toHaveAttribute("aria-valuetext", "not set");
    expect(slider).not.toHaveAttribute("aria-valuenow");
  });

  it("nudges with arrow keys from the 50 midpoint when unset, clamps at the ends", () => {
    const onChange = vi.fn();
    render(<CheckinSlider label="Wifi" value={null} onChange={onChange} />, { wrapper: Wrapper });
    const slider = screen.getByRole("slider", { name: "Wifi" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(51);

    onChange.mockClear();
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(40);
  });

  it("honors Home/End bounds on a set value", () => {
    const onChange = vi.fn();
    render(<CheckinSlider label="Wifi" value={40} onChange={onChange} />, { wrapper: Wrapper });
    const slider = screen.getByRole("slider", { name: "Wifi" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("renders the edit-mode clear control with a translated label", () => {
    const onClear = vi.fn();
    render(
      <CheckinSlider label="Wifi" value={40} onChange={() => {}} showClear onClear={onClear} />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Wifi" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("vibrates on first touch only, not on every drag move", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, width: 100, top: 0, right: 100, bottom: 10, height: 10, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    render(<CheckinSlider label="Wifi" value={null} onChange={() => {}} />, { wrapper: Wrapper });
    const slider = screen.getByRole("slider", { name: "Wifi" });

    fireEvent.pointerDown(slider, { clientX: 30, pointerId: 1 });
    expect(vibrate).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(window, { clientX: 40 });
    fireEvent.pointerMove(window, { clientX: 50 });
    expect(vibrate).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window);

    vi.restoreAllMocks();
  });
});

describe("CheckinDrawer", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ checkin: null, revisitWindowHours: 24 }),
    });
  });

  it("shows the overall hint exactly once when overall is unset", () => {
    renderDrawer({ isAuthenticated: true });
    expect(screen.getAllByText("Set Overall experience to check in")).toHaveLength(1);
  });

  it("hides the photo picker in edit mode and shows the delete control", () => {
    renderDrawer({
      mode: "edit",
      editCheckinId: CHECKIN,
      initialScores: { overall: 70 },
      isAuthenticated: true,
    });
    expect(screen.queryByRole("button", { name: "Add photos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete check-in" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit check-in" })).toBeInTheDocument();
  });

  it("gates on submit when unauthenticated instead of posting", async () => {
    // jsdom lacks scrollIntoView; the gate must call it so the prompt is not
    // stranded below the drawer fold (BRAWUKA-247).
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderDrawer({ isAuthenticated: false });

    const overall = screen.getByRole("slider", { name: "Overall experience" });
    fireEvent.keyDown(overall, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/checkins",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("drops to the sign-in gate when the last-visit probe 401s", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    renderDrawer(); // isAuthenticated unknown — the CDN-cached cafe shell case

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const overall = screen.getByRole("slider", { name: "Overall experience" });
    fireEvent.keyDown(overall, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
  });

  it("guards a dirty draft behind the discard confirm instead of closing", async () => {
    const onOpenChange = renderDrawer({ isAuthenticated: true });

    const wifi = screen.getByRole("slider", { name: "Wifi" });
    fireEvent.keyDown(wifi, { key: "ArrowRight" });

    const dialog = screen.getByRole("dialog", { name: "Check in" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.getByText("Discard this check-in?")).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes a pristine draft without the discard confirm", async () => {
    const onOpenChange = renderDrawer({ isAuthenticated: true });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByText("Discard this check-in?")).not.toBeInTheDocument();
  });
  it("opens a same-day revisit directly in edit mode with the last values prefilled (DG64)", async () => {
    const visited_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        checkin: {
          id: CHECKIN,
          scores: { wifi: 80, overall: 90 },
          max_stay: "3h",
          note: "Corner seat",
          visited_at,
        },
        revisitWindowHours: 24,
      }),
    });
    renderDrawer({ isAuthenticated: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Edit check-in" })).toBeInTheDocument();
    });
    // Edit chrome, not create chrome: delete control in, photo picker out,
    // and the confirm button saves changes.
    expect(screen.getByRole("button", { name: "Delete check-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add photos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What should the next nomad know?")).toHaveValue(
      "Corner seat",
    );
    // The 90-day same-as-last banner must not compete with the prefilled edit.
    expect(screen.queryByRole("button", { name: "Same" })).not.toBeInTheDocument();
  });

  it("stays in create mode with the same-as-last banner when the last visit is past the window (DG63/DG64)", async () => {
    const visited_at = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        checkin: {
          id: CHECKIN,
          scores: { wifi: 80, overall: 90 },
          max_stay: "3h",
          note: "Corner seat",
          visited_at,
        },
        revisitWindowHours: 24,
      }),
    });
    renderDrawer({ isAuthenticated: true });

    // Wait for the probe so the create dialog below is the settled state.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Same" })).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Check in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete check-in" })).not.toBeInTheDocument();
  });

  it("converts a raced POST 409 into a silent PATCH without surfacing an error (DG64)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/checkins/last")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ checkin: null, revisitWindowHours: 24 }),
        });
      }
      if (init?.method === "PATCH") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ cafeId: CAFE }) });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({ error: "duplicate_checkin", existing_checkin_id: CHECKIN }),
      });
    });
    renderDrawer({ isAuthenticated: true });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/checkins/last"),
      );
    });
    const overall = screen.getByRole("slider", { name: "Overall experience" });
    fireEvent.keyDown(overall, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/checkins/${CHECKIN}`,
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(screen.queryByText("Couldn't save your check-in")).not.toBeInTheDocument();
  });

  it("toasts that photos were not saved when a raced 409 converts to PATCH (BRAWUKA-126)", async () => {
    toastSpy.mockClear();
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/checkins/last")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ checkin: null, revisitWindowHours: 24 }),
        });
      }
      if (init?.method === "PATCH") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ cafeId: CAFE }) });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({ error: "duplicate_checkin", existing_checkin_id: CHECKIN }),
      });
    });
    renderDrawer({ isAuthenticated: true });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/checkins/last"),
      );
    });

    // Stage a photo, then submit: the POST 409s and silently converts to a
    // PATCH that cannot carry photo_ids.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
    });
    // Wait for the mocked upload to flip the tile off "uploading" —
    // submitting mid-upload short-circuits with photos_uploading.
    await waitFor(() => {
      expect(vi.mocked(uploadPhoto)).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.querySelector(".animate-pulse")).toBeNull();
    });
    const overall = screen.getByRole("slider", { name: "Overall experience" });
    fireEvent.keyDown(overall, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/checkins/${CHECKIN}`,
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    // The PATCH contract carries no photos — the body must not smuggle them.
    const patchCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).not.toHaveProperty(
      "photo_ids",
    );
    await waitFor(
      () => {
        expect(toastSpy).toHaveBeenCalledWith(
          "Check-in updated — photos weren't saved (they can only be added on the first check-in)",
          expect.objectContaining({ timeout: 3000 }),
        );
      },
      { timeout: 3000 },
    );
  });

  it("toasts that staged photos were not saved when the revisit probe preempts to edit (BRAWUKA-126)", async () => {
    toastSpy.mockClear();
    // A cached probe resolves synchronously on mount, so the preempt fires on
    // the first render — before the restored photos can mark the form dirty.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["last-checkin", CAFE], {
      checkin: {
        id: CHECKIN,
        scores: { overall: 90 },
        max_stay: null,
        note: null,
        visited_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      revisitWindowHours: 24,
    });
    renderDrawer(
      {
        isAuthenticated: true,
        initialPhotos: [
          {
            id: "p1",
            previewUrl: "blob:fake",
            status: "staged",
            file: new File(["x"], "p.jpg", { type: "image/jpeg" }),
          },
        ],
      },
      queryClient,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Edit check-in" })).toBeInTheDocument();
    });
    expect(toastSpy).toHaveBeenCalledWith(
      "Switched to updating today's check-in — photos can only be added on the first check-in, so they weren't saved",
      expect.objectContaining({ timeout: 4000 }),
    );
  });

  it("does not toast the photo notice when a preempted create had no staged photos", async () => {
    toastSpy.mockClear();
    const visited_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        checkin: { id: CHECKIN, scores: { overall: 90 }, visited_at },
        revisitWindowHours: 24,
      }),
    });
    renderDrawer({ isAuthenticated: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Edit check-in" })).toBeInTheDocument();
    });
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("photos"),
      expect.anything(),
    );
  });

  it("sends one idempotency key per open and reuses it on inline retry (DG61)", async () => {
    const posts: Array<Record<string, unknown>> = [];
    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/checkins/last")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ checkin: null, revisitWindowHours: 24 }),
        });
      }
      if (init?.method === "POST") {
        attempts += 1;
        posts.push(JSON.parse(init.body as string));
        if (attempts === 1) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ checkinId: CHECKIN }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    renderDrawer({ isAuthenticated: true });
    const overall = screen.getByRole("slider", { name: "Overall experience" });
    fireEvent.keyDown(overall, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    // First attempt fails: the inline retry UI appears.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(posts).toHaveLength(2);
    });
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(posts[0].idempotency_key).toMatch(uuidV4);
    // The retry reuses the open's key — the server dedupes instead of
    // writing a second row.
    expect(posts[1].idempotency_key).toBe(posts[0].idempotency_key);
  });

  it("mints a fresh idempotency key on reopen (DG61)", async () => {
    const posts: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/checkins/last")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ checkin: null, revisitWindowHours: 24 }),
        });
      }
      if (init?.method === "POST") {
        posts.push(JSON.parse(init.body as string));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ checkinId: CHECKIN }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    const submit = async () => {
      renderDrawer({ isAuthenticated: true });
      fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
        key: "ArrowRight",
      });
      fireEvent.click(screen.getByRole("button", { name: "Check in" }));
      await waitFor(() => {
        expect(posts.length).toBeGreaterThan(0);
      });
    };
    await submit();
    const firstKey = posts[0].idempotency_key;
    cleanup();
    posts.length = 0;
    await submit();
    expect(posts[0].idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(posts[0].idempotency_key).not.toBe(firstKey);
  });
});

describe("resolveRevisitCheckin", () => {
  const NOW = new Date("2026-09-07T12:00:00.000Z").getTime();
  const row = (visited_at: string) => ({
    id: CHECKIN,
    scores: {},
    max_stay: null,
    note: null,
    visited_at,
  });

  it("returns the check-in when it falls inside the server-provided window", () => {
    const visited_at = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    expect(
      resolveRevisitCheckin({ checkin: row(visited_at), revisitWindowHours: 24 }, NOW),
    ).toEqual(row(visited_at));
  });

  it("returns null at/past the window edge, without a check-in, or without a window", () => {
    const atEdge = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    expect(resolveRevisitCheckin({ checkin: row(atEdge), revisitWindowHours: 24 }, NOW)).toBeNull();
    const pastEdge = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    expect(
      resolveRevisitCheckin({ checkin: row(pastEdge), revisitWindowHours: 24 }, NOW),
    ).toBeNull();
    expect(resolveRevisitCheckin({ checkin: null, revisitWindowHours: 24 }, NOW)).toBeNull();
    const recent = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(resolveRevisitCheckin({ checkin: row(recent) }, NOW)).toBeNull();
    expect(resolveRevisitCheckin(undefined, NOW)).toBeNull();
  });
});
