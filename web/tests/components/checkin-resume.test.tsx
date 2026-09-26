import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { CheckinResume } from "@/components/checkin/checkin-resume";
import type { PendingCheckinDraft } from "@/lib/checkin/pending-checkin";

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockPathname = "/cafes/example";
const mockToast = vi.fn();
const mockLoadPendingCheckin = vi.fn();
const mockClearPendingCheckin = vi.fn();
const mockDrawerRender = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
}));

vi.mock("@heroui/react", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `trans_${key}`,
}));

vi.mock("@/components/checkin/checkin-drawer", () => ({
  CHECKIN_RESUME_PARAM: "checkin_resume",
  CheckinDrawer: (props: Record<string, unknown>) => {
    mockDrawerRender(props);
    return props.isOpen ? <div data-testid="checkin-drawer">Drawer Open</div> : null;
  },
}));

vi.mock("@/lib/checkin/pending-checkin", () => ({
  loadPendingCheckin: (...args: unknown[]) => mockLoadPendingCheckin(...args),
  clearPendingCheckin: (...args: unknown[]) => Promise.resolve(mockClearPendingCheckin(...args)),
}));

describe("CheckinResume", () => {
  const sampleDraft: PendingCheckinDraft = {
    cafeId: "cafe-123",
    cafeName: "Test Cafe",
    scores: { overall: 85 },
    maxStay: null,
    note: "Great coffee",
    photos: [
      {
        id: "p1",
        file: new File(["image-bytes"], "photo.jpg", { type: "image/jpeg" }),
        name: "photo.jpg",
      },
    ],
    createdAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockPathname = "/cafes/example";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when checkin_resume is not present in URL", async () => {
    mockSearchParams = new URLSearchParams("foo=bar");
    render(<CheckinResume draftTtlHours={24} />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockLoadPendingCheckin).not.toHaveBeenCalled();
    expect(screen.queryByTestId("checkin-drawer")).not.toBeInTheDocument();
  });

  it("survives URL cleanup while draft read is pending and opens drawer once resolved", async () => {
    mockSearchParams = new URLSearchParams("checkin_resume=1");

    let resolveDraft!: (draft: PendingCheckinDraft | null) => void;
    mockLoadPendingCheckin.mockReturnValue(
      new Promise<PendingCheckinDraft | null>((resolve) => {
        resolveDraft = resolve;
      }),
    );

    const { rerender } = render(<CheckinResume draftTtlHours={24} />);

    // URL cleanup is triggered immediately
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/cafes/example", { scroll: false });
    expect(mockLoadPendingCheckin).toHaveBeenCalledTimes(1);

    // Simulate router.replace updating the URL before the draft read finishes
    mockSearchParams = new URLSearchParams("");
    rerender(<CheckinResume draftTtlHours={24} />);

    // Should not trigger a second replace or read
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockLoadPendingCheckin).toHaveBeenCalledTimes(1);

    // Drawer is not open yet while promise is pending
    expect(screen.queryByTestId("checkin-drawer")).not.toBeInTheDocument();

    // Resolve the delayed draft read
    await act(async () => {
      resolveDraft(sampleDraft);
    });

    // Drawer should open and toast should fire
    expect(screen.getByTestId("checkin-drawer")).toBeInTheDocument();
    expect(mockDrawerRender).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        cafeId: "cafe-123",
        cafeName: "Test Cafe",
        initialScores: { overall: 85 },
        initialNote: "Great coffee",
      }),
    );
    expect(mockToast).toHaveBeenCalledWith("trans_draftRestored", { timeout: 4000 });
  });

  it("preserves unrelated query parameters during URL cleanup", async () => {
    mockSearchParams = new URLSearchParams("locale=zh&checkin_resume=1&tab=details");
    mockLoadPendingCheckin.mockResolvedValue(null);

    render(<CheckinResume draftTtlHours={24} />);

    expect(mockReplace).toHaveBeenCalledWith("/cafes/example?locale=zh&tab=details", {
      scroll: false,
    });
  });

  it("handles missing or expired draft without opening drawer", async () => {
    mockSearchParams = new URLSearchParams("checkin_resume=1");
    mockLoadPendingCheckin.mockResolvedValue(null);

    render(<CheckinResume draftTtlHours={24} />);

    expect(mockReplace).toHaveBeenCalledWith("/cafes/example", { scroll: false });
    await act(async () => {});

    expect(screen.queryByTestId("checkin-drawer")).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("cancels in-flight recovery when component unmounts", async () => {
    mockSearchParams = new URLSearchParams("checkin_resume=1");

    let resolveDraft!: (draft: PendingCheckinDraft | null) => void;
    mockLoadPendingCheckin.mockReturnValue(
      new Promise<PendingCheckinDraft | null>((resolve) => {
        resolveDraft = resolve;
      }),
    );

    const { unmount } = render(<CheckinResume draftTtlHours={24} />);
    expect(mockLoadPendingCheckin).toHaveBeenCalledTimes(1);

    // Unmount while read is in flight
    unmount();

    // Resolve after unmount
    await act(async () => {
      resolveDraft(sampleDraft);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("cancels in-flight recovery when navigating away to another pathname", async () => {
    mockPathname = "/cafes/cafe-a";
    mockSearchParams = new URLSearchParams("checkin_resume=1");

    let resolveDraft!: (draft: PendingCheckinDraft | null) => void;
    mockLoadPendingCheckin.mockReturnValue(
      new Promise<PendingCheckinDraft | null>((resolve) => {
        resolveDraft = resolve;
      }),
    );

    const { rerender } = render(<CheckinResume draftTtlHours={24} />);
    expect(mockReplace).toHaveBeenCalledWith("/cafes/cafe-a", { scroll: false });

    // Navigate to a different page while draft read is in flight
    mockPathname = "/cafes/cafe-b";
    mockSearchParams = new URLSearchParams("");
    rerender(<CheckinResume draftTtlHours={24} />);

    // Resolve the read started for cafe-a
    await act(async () => {
      resolveDraft(sampleDraft);
    });

    // Drawer should NOT open because navigation away cancelled the restore
    expect(screen.queryByTestId("checkin-drawer")).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("handles repeated callback navigation correctly", async () => {
    // 1st callback navigation
    mockPathname = "/cafes/first";
    mockSearchParams = new URLSearchParams("checkin_resume=1");
    mockLoadPendingCheckin.mockResolvedValueOnce(sampleDraft);

    const { rerender } = render(<CheckinResume draftTtlHours={24} />);

    expect(mockReplace).toHaveBeenCalledWith("/cafes/first", { scroll: false });
    await act(async () => {});
    expect(screen.getByTestId("checkin-drawer")).toBeInTheDocument();

    // Close the drawer
    const onOpenChange = mockDrawerRender.mock.calls.at(-1)?.[0]?.onOpenChange as (
      open: boolean,
    ) => void;
    await act(async () => {
      onOpenChange(false);
    });
    expect(mockClearPendingCheckin).toHaveBeenCalled();

    // Route has updated to clean URL
    mockSearchParams = new URLSearchParams("");
    rerender(<CheckinResume draftTtlHours={24} />);

    // 2nd callback navigation arrives later
    const secondDraft: PendingCheckinDraft = {
      ...sampleDraft,
      cafeId: "cafe-456",
      cafeName: "Second Cafe",
    };
    mockPathname = "/cafes/second";
    mockSearchParams = new URLSearchParams("checkin_resume=1");
    mockLoadPendingCheckin.mockResolvedValueOnce(secondDraft);

    rerender(<CheckinResume draftTtlHours={24} />);

    expect(mockReplace).toHaveBeenCalledWith("/cafes/second", { scroll: false });
    await act(async () => {});

    expect(mockDrawerRender).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        cafeId: "cafe-456",
        cafeName: "Second Cafe",
      }),
    );
  });
});
