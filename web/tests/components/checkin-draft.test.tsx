import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import { CheckinResume } from "@/components/checkin/checkin-resume";
import {
  savePendingCheckin,
  loadPendingCheckin,
  clearPendingCheckin,
} from "@/lib/checkin/pending-checkin";
import { uploadPhoto } from "@/lib/images/client-upload";
import messages from "../../messages/en.json";

// The real hook pings /api/health on an interval through a module-level
// singleton; the fetch mocks below would flip tests offline mid-run.
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));

// IndexedDB is not available in jsdom — the store module is mocked and its
// calls asserted directly.
vi.mock("@/lib/checkin/pending-checkin", () => ({
  savePendingCheckin: vi.fn().mockResolvedValue(undefined),
  loadPendingCheckin: vi.fn().mockResolvedValue(null),
  clearPendingCheckin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/images/client-upload", () => ({
  uploadPhoto: vi.fn(),
  toWebP: vi.fn(),
}));

let mockSearch = "";
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => "/cafes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
  useRouter: () => ({ replace: mockReplace }),
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

function renderDrawer(props?: Partial<React.ComponentProps<typeof CheckinDrawer>>) {
  const onOpenChange = vi.fn();
  render(
    <CheckinDrawer isOpen onOpenChange={onOpenChange} cafeId={CAFE} cafeName="Kiosk" {...props} />,
    { wrapper: Wrapper },
  );
  return onOpenChange;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not rendered");
  return input as HTMLInputElement;
}

function postedCheckinBody(): Record<string, unknown> {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([url]) => url === "/api/checkins");
  if (!call) throw new Error("POST /api/checkins not called");
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe("check-in sign-in gate draft (DG66/DG59)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = "";
    vi.mocked(loadPendingCheckin).mockResolvedValue(null);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ checkin: null }),
    });
    URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
    URL.revokeObjectURL = vi.fn();
  });

  it("stages photos locally without uploading when logged out (DG59)", async () => {
    renderDrawer({ isAuthenticated: false });

    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    // The tile renders its preview immediately, with no upload and no error.
    await waitFor(() => expect(document.querySelector("img")).toBeInTheDocument());
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("persists the full draft and points OAuth back here at the gate (DG66)", async () => {
    renderDrawer({ isAuthenticated: false });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
      key: "ArrowRight",
    });
    fireEvent.change(screen.getByPlaceholderText("What should the next nomad know?"), {
      target: { value: "great espresso bar" },
    });
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    expect(savePendingCheckin).toHaveBeenCalledOnce();
    const draft = vi.mocked(savePendingCheckin).mock.calls[0][0];
    expect(draft.cafeId).toBe(CAFE);
    expect(draft.cafeName).toBe("Kiosk");
    expect(draft.scores.overall).toBe(51);
    expect(draft.note).toBe("great espresso bar");
    expect(draft.photos).toHaveLength(1);
    expect(draft.photos[0].file).toBe(file);

    const nextInputs = document.querySelectorAll('input[name="next"]');
    expect(nextInputs).toHaveLength(2);
    for (const input of nextInputs) {
      expect((input as HTMLInputElement).value).toContain("checkin_resume=1");
    }
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/checkins",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uploads staged photos at publish time and posts their ids (DG59)", async () => {
    vi.mocked(uploadPhoto).mockResolvedValue("uuid-1");
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    renderDrawer({
      isAuthenticated: true,
      initialPhotos: [{ id: "p1", previewUrl: "blob:mock-p1", status: "staged", file }],
    });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/checkins",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(postedCheckinBody().photo_ids).toEqual(["uuid-1"]);
    expect(clearPendingCheckin).toHaveBeenCalled();
  });

  it("restores the draft after the OAuth bounce and publishes with one tap (DG66)", async () => {
    mockSearch = "checkin_resume=1";
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    vi.mocked(loadPendingCheckin).mockResolvedValue({
      cafeId: CAFE,
      cafeName: "Kiosk",
      scores: { wifi: 60, overall: 80 },
      maxStay: null,
      note: "restored note",
      photos: [{ id: "p1", file }],
      createdAt: Date.now(),
    });
    vi.mocked(uploadPhoto).mockResolvedValue("uuid-9");

    render(<CheckinResume draftTtlHours={72} />, { wrapper: Wrapper });

    // The drawer reopens with every input restored.
    await screen.findByRole("dialog", { name: "Check in" });
    expect(mockReplace).toHaveBeenCalled();
    expect(screen.getByDisplayValue("restored note")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/checkins",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const body = postedCheckinBody();
    expect(body.cafe_id).toBe(CAFE);
    expect(body.scores).toEqual({ wifi: 60, overall: 80 });
    expect(body.note).toBe("restored note");
    expect(body.photo_ids).toEqual(["uuid-9"]);
    await waitFor(() => expect(clearPendingCheckin).toHaveBeenCalled());
  });

  it("does not open the drawer without the resume flag", async () => {
    render(<CheckinResume draftTtlHours={72} />, { wrapper: Wrapper });
    await waitFor(() => expect(loadPendingCheckin).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
