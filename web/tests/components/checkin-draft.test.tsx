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
import * as pendingCheckin from "@/lib/checkin/pending-checkin";
import { uploadPhoto } from "@/lib/images/client-upload";
import { toast } from "@heroui/react";
import messages from "../../messages/en.json";

// The real hook pings /api/health on an interval through a module-level
// singleton; the fetch mocks below would flip tests offline mid-run.
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));

vi.mock("@/lib/images/client-upload", () => ({
  uploadPhoto: vi.fn(),
  toWebP: vi.fn(),
}));

vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast: vi.fn() };
});

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
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockSearch = "";
    await clearPendingCheckin();
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
    const saveSpy = vi.spyOn(pendingCheckin, "savePendingCheckin");
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
    await waitFor(() => expect(saveSpy).toHaveBeenCalledOnce());
    const draft = saveSpy.mock.calls[0][0];
    expect(draft.cafeId).toBe(CAFE);
    expect(draft.cafeName).toBe("Kiosk");
    expect(draft.scores.overall).toBe(51);
    expect(draft.note).toBe("great espresso bar");
    expect(draft.photos).toHaveLength(1);
    expect(draft.photos[0].name).toBe("photo.jpg");
    expect(draft.photos[0].file).toBe(file);
    // Verify draft was genuinely persisted in IndexedDB and can be loaded back
    const stored = await loadPendingCheckin(72 * 3_600_000);
    expect(stored).not.toBeNull();
    expect(stored?.cafeId).toBe(CAFE);
    expect(stored?.note).toBe("great espresso bar");

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
    const clearSpy = vi.spyOn(pendingCheckin, "clearPendingCheckin");
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
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
  });

  it("restores the draft after the OAuth bounce and publishes with one tap (DG66)", async () => {
    const clearSpy = vi.spyOn(pendingCheckin, "clearPendingCheckin");
    mockSearch = "checkin_resume=1";
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await savePendingCheckin({
      cafeId: CAFE,
      cafeName: "Kiosk",
      scores: { wifi: 60, overall: 80 },
      maxStay: null,
      note: "restored note",
      photos: [{ id: "p1", name: "photo.jpg", file }],
      createdAt: Date.now(),
    });
    vi.mocked(uploadPhoto).mockResolvedValue("uuid-9");

    render(<CheckinResume draftTtlHours={72} />, { wrapper: Wrapper });

    // The drawer reopens with every input restored from real IndexedDB.
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
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
    expect(await loadPendingCheckin(72 * 3_600_000)).toBeNull();
  });

  it("does not open the drawer without the resume flag", async () => {
    const loadSpy = vi.spyOn(pendingCheckin, "loadPendingCheckin");
    render(<CheckinResume draftTtlHours={72} />, { wrapper: Wrapper });
    await waitFor(() => expect(loadSpy).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stages the draft and drops to the gate when the submit 401s", async () => {
    const saveSpy = vi.spyOn(pendingCheckin, "savePendingCheckin");
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/checkins" && init?.method === "POST") {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ checkin: null }) };
    });
    renderDrawer({ isAuthenticated: true });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const draft = saveSpy.mock.calls[0][0];
    expect(draft.cafeId).toBe(CAFE);
    expect(draft.scores.overall).toBe(51);

    const stored = await loadPendingCheckin(72 * 3_600_000);
    expect(stored?.cafeId).toBe(CAFE);
  });

  it("stages the draft and drops to the gate when the publish-time photo upload 401s", async () => {
    const saveSpy = vi.spyOn(pendingCheckin, "savePendingCheckin");
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("unauthorized"));
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    renderDrawer({
      isAuthenticated: true,
      initialPhotos: [{ id: "p1", previewUrl: "blob:mock-p1", status: "staged", file }],
    });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const draft = saveSpy.mock.calls[0][0];
    expect(draft.cafeId).toBe(CAFE);
    expect(draft.photos).toHaveLength(1);

    const stored = await loadPendingCheckin(72 * 3_600_000);
    expect(stored?.cafeId).toBe(CAFE);
    expect(stored?.photos).toHaveLength(1);

    // The ordinary photo-failure branch must not run: no inline retry, no POST attempt.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/checkins",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("opens the gate instead of a retry tile when an immediate photo upload 401s", async () => {
    const saveSpy = vi.spyOn(pendingCheckin, "savePendingCheckin");
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("unauthorized"));
    renderDrawer({ isAuthenticated: true });

    fireEvent.change(fileInput(), {
      target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    // Not a tile error: retrying this tile could never succeed.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(document.querySelector(".border-danger")).not.toBeInTheDocument();

    // The selection survives the gate, so the post-OAuth resume can still publish it.
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(saveSpy.mock.calls.at(-1)?.[0].photos).toHaveLength(1);
    expect((await loadPendingCheckin(72 * 3_600_000))?.photos).toHaveLength(1);
  });

  it("escalates a 401 raised by a tile retry to the gate too", async () => {
    vi.mocked(uploadPhoto)
      .mockRejectedValueOnce(new Error("photo_upload_failed"))
      .mockRejectedValueOnce(new Error("unauthorized"));
    renderDrawer({ isAuthenticated: true });

    fireEvent.change(fileInput(), {
      target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] },
    });

    // A genuine photo failure still offers the in-place retry.
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("re-stages the draft when input changes while the gate is visible", async () => {
    const saveSpy = vi.spyOn(pendingCheckin, "savePendingCheckin");
    renderDrawer({ isAuthenticated: false });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => {
      expect(screen.getByText(/Sign in to publish your check-in/)).toBeInTheDocument();
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);

    // The gate is inline — the composer keeps editing above it.
    fireEvent.change(screen.getByPlaceholderText("What should the next nomad know?"), {
      target: { value: "edited after the gate" },
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy.mock.calls[1][0].note).toBe("edited after the gate");

    const stored = await loadPendingCheckin(72 * 3_600_000);
    expect(stored?.note).toBe("edited after the gate");
  });
  it("reuses publish-time upload ids on retry instead of re-uploading", async () => {
    vi.mocked(uploadPhoto).mockResolvedValue("uuid-1");
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/checkins" && init?.method === "POST") {
        // First POST fails after the photo already uploaded; retry succeeds.
        const posts = vi
          .mocked(globalThis.fetch)
          .mock.calls.filter(([u, i]) => u === "/api/checkins" && (i as RequestInit)?.method === "POST").length;
        if (posts === 1) return { ok: false, status: 500, json: async () => ({ message: "boom" }) };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ checkin: null }) };
    });
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    renderDrawer({
      isAuthenticated: true,
      initialPhotos: [{ id: "p1", previewUrl: "blob:mock-p1", status: "staged", file }],
    });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Overall experience" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    await waitFor(() => {
      const posts = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([u, i]) => u === "/api/checkins" && (i as RequestInit)?.method === "POST");
      expect(posts).toHaveLength(2);
    });
    // The retried POST reused the first upload — no re-upload, no orphan.
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    const posts = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([u, i]) => u === "/api/checkins" && (i as RequestInit)?.method === "POST");
    const body = JSON.parse((posts[1][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.photo_ids).toEqual(["uuid-1"]);
  });

  it("toasts the 10 MB reason when an upload is rejected for size (artifact §3.5)", async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("photo_too_large"));
    renderDrawer({ isAuthenticated: true });

    const file = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("That photo is larger than 10 MB.", { timeout: 4000 }),
    );
    // The tile keeps its retry affordance — the toast only names the reason.
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
