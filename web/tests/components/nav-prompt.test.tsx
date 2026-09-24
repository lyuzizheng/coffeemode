import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "@heroui/react";
import { apiFetch, ApiError } from "@/lib/http";
import { useNavPrompt, type NavPromptItem } from "@/components/discovery/use-nav-prompt";
import messages from "../../messages/en.json";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

vi.mock("@heroui/react", async () => {
  const actual = await vi.importActual<typeof import("@heroui/react")>("@heroui/react");
  return {
    ...actual,
    toast: vi.fn(),
  };
});

const mockApiFetch = vi.mocked(apiFetch);
const mockToast = vi.mocked(toast);

const mockPromptItem: NavPromptItem = {
  id: "01921a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b",
  created_at: "2026-09-20T10:00:00Z",
  cafe: {
    id: "cafe-test-1",
    name: "Roast Lab",
    cover: null,
  },
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("useNavPrompt (BRAWUKA-443)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    // Synchronous or fast idle callback for tests
    window.requestIdleCallback = ((cb: () => void) => {
      return window.setTimeout(cb, 0);
    }) as unknown as typeof window.requestIdleCallback;
    window.cancelIdleCallback = ((id: number) => {
      window.clearTimeout(id);
    }) as unknown as typeof window.cancelIdleCallback;
  });

  describe("prompt fetch & sessionFlag", () => {
    it("sets session flag and sets item when GET /api/navigations/prompt succeeds with prompt", async () => {
      mockApiFetch.mockResolvedValueOnce({ prompt: mockPromptItem });
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.item).toEqual(mockPromptItem);
      });
      expect(window.sessionStorage.getItem("cm_nav_prompt_shown")).toBe("1");
    });

    it("sets session flag when GET /api/navigations/prompt succeeds with null prompt", async () => {
      mockApiFetch.mockResolvedValueOnce({ prompt: null });
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(window.sessionStorage.getItem("cm_nav_prompt_shown")).toBe("1");
      });
      expect(result.current.item).toBeNull();
    });

    it("does NOT set session flag when GET /api/navigations/prompt fails with 500 ApiError", async () => {
      mockApiFetch.mockRejectedValueOnce(
        new ApiError({ status: 500, code: "internal_error" }),
      );
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      // Wait a tick for the rejected promise to settle
      await new Promise((r) => setTimeout(r, 20));

      expect(window.sessionStorage.getItem("cm_nav_prompt_shown")).toBeNull();
      expect(result.current.item).toBeNull();
    });

    it("does NOT set session flag when GET /api/navigations/prompt fails with 401 ApiError", async () => {
      mockApiFetch.mockRejectedValueOnce(
        new ApiError({ status: 401, code: "unauthorized" }),
      );
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await new Promise((r) => setTimeout(r, 20));

      expect(window.sessionStorage.getItem("cm_nav_prompt_shown")).toBeNull();
      expect(result.current.item).toBeNull();
    });
  });

  describe("resolve answer", () => {
    it("on successful resolve 'visited': sets gone, opens check-in, no error toast", async () => {
      mockApiFetch
        .mockResolvedValueOnce({ prompt: mockPromptItem })
        .mockResolvedValueOnce({ outcome: "visited" });
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.item).toEqual(mockPromptItem));

      await act(async () => {
        await result.current.answer("visited");
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/navigations/${mockPromptItem.id}/resolve`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ outcome: "visited" }),
        }),
      );
      expect(result.current.item).toBeNull();
      expect(result.current.pending).toBeNull();
      expect(onCheckIn).toHaveBeenCalledTimes(1);
      expect(onCheckIn).toHaveBeenCalledWith(mockPromptItem.cafe.id, mockPromptItem.cafe.name);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("on failed resolve 'visited': does NOT set gone, does NOT open check-in, shows toast", async () => {
      mockApiFetch
        .mockResolvedValueOnce({ prompt: mockPromptItem })
        .mockRejectedValueOnce(
          new ApiError({ status: 500, code: "internal_error" }),
        );
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.item).toEqual(mockPromptItem));

      await act(async () => {
        await result.current.answer("visited");
      });

      // Item remains visible (not gone) so user can retry
      expect(result.current.item).toEqual(mockPromptItem);
      expect(result.current.pending).toBeNull();
      // Must NOT open check-in
      expect(onCheckIn).not.toHaveBeenCalled();
      // Must show failure toast
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith("Couldn't save — try again?", { timeout: 4000 });
    });

    it("on failed resolve 'not_yet': does NOT set gone, shows toast, resets pending", async () => {
      mockApiFetch
        .mockResolvedValueOnce({ prompt: mockPromptItem })
        .mockRejectedValueOnce(new Error("network failure"));
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.item).toEqual(mockPromptItem));

      await act(async () => {
        await result.current.answer("not_yet");
      });

      expect(result.current.item).toEqual(mockPromptItem);
      expect(result.current.pending).toBeNull();
      expect(onCheckIn).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledTimes(1);
    });

    it("on successful resolve 'wont_go': sets gone, does not open check-in", async () => {
      mockApiFetch
        .mockResolvedValueOnce({ prompt: mockPromptItem })
        .mockResolvedValueOnce({ outcome: "wont_go" });
      const onCheckIn = vi.fn();

      const { result } = renderHook(
        () => useNavPrompt({ enabled: true, onCheckIn }),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.item).toEqual(mockPromptItem));

      await act(async () => {
        await result.current.answer("wont_go");
      });

      expect(result.current.item).toBeNull();
      expect(result.current.pending).toBeNull();
      expect(onCheckIn).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });
  });
});
