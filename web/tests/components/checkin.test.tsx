import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinSlider } from "@/components/checkin/checkin-slider";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import messages from "../../messages/en.json";
// The real hook pings /api/health on an interval through a module-level
// singleton; the fetch mocks below would flip tests offline mid-run.
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));

const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

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

function renderDrawer(props?: Partial<React.ComponentProps<typeof CheckinDrawer>>) {
  const onOpenChange = vi.fn();
  render(
    <CheckinDrawer
      isOpen
      onOpenChange={onOpenChange}
      cafeId={CAFE}
      cafeName="Kiosk"
      {...props}
    />,
    { wrapper: Wrapper },
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
      json: async () => ({ checkin: null }),
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
    renderDrawer({ isAuthenticated: false });

    const overall = screen.getByRole("slider", { name: "Overall experience" });
    fireEvent.keyDown(overall, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
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
});
