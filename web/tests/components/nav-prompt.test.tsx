import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../messages/en.json";
import { NavPromptView } from "@/components/discovery/nav-prompt";
import {
  useNavPrompt,
  type NavPromptItem,
} from "@/components/discovery/use-nav-prompt";

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => true };
});

const ITEM: NavPromptItem = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
  created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  cafe: { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22", name: "Seed Cafe", cover: null },
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function renderView(overrides: Partial<Parameters<typeof NavPromptView>[0]> = {}) {
  const onAnswer = vi.fn();
  render(
    <Wrapper>
      <NavPromptView item={ITEM} pending={null} onAnswer={onAnswer} placement="surface" {...overrides} />
    </Wrapper>,
  );
  return { onAnswer };
}

describe("NavPromptView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the headline, context line, and three honest options — no ×", () => {
    renderView();
    expect(screen.getByText("Grabbed a coffee at Seed Cafe?")).toBeInTheDocument();
    expect(screen.getByText("You navigated here 2 days ago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I did!" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Won't go" })).toBeInTheDocument();
    // DG81: no close button anywhere — the three options are the only exits.
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("auto-collapses to the pill after the configured delay", async () => {
    renderView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    // The exiting card lingers until its exit animation finishes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByText("Grabbed a coffee at Seed Cafe?")).toBeNull();
    const pill = screen.getByRole("button", { name: /Grab that coffee\?/ });
    // DG88: the pill stays until answered — no second timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(pill).toBeInTheDocument();
  });

  it("re-expands from the pill back to the card", () => {
    renderView();
    act(() => {
      vi.advanceTimersByTime(8_100);
    });
    fireEvent.click(screen.getByRole("button", { name: /Grab that coffee\?/ }));
    expect(screen.getByText("Grabbed a coffee at Seed Cafe?")).toBeInTheDocument();
  });

  it("pauses the collapse timer while the user interacts (DG28)", () => {
    renderView();
    const card = screen.getByRole("status");
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Grabbed a coffee at Seed Cafe?")).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(8_100);
    });
    expect(screen.getByRole("button", { name: /Grab that coffee\?/ })).toBeInTheDocument();
  });

  it("routes each option to its outcome", () => {
    const { onAnswer } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "I did!" }));
    expect(onAnswer).toHaveBeenCalledWith("visited");
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(onAnswer).toHaveBeenCalledWith("not_yet");
    fireEvent.click(screen.getByRole("button", { name: "Won't go" }));
    expect(onAnswer).toHaveBeenCalledWith("wont_go");
  });

  it("says 'yesterday' for a day-old navigation", () => {
    renderView({
      item: { ...ITEM, created_at: new Date(Date.now() - 30 * 3_600_000).toISOString() },
    });
    expect(screen.getByText("You navigated here yesterday")).toBeInTheDocument();
  });
});

describe("useNavPrompt", () => {
  const fetchMock = vi.fn();

  function Hook({ enabled = true, onCheckIn = vi.fn() }: { enabled?: boolean; onCheckIn?: (id: string, name: string) => void }) {
    const { item, answer } = useNavPrompt({ enabled, onCheckIn });
    return (
      <div>
        <span data-testid="item">{item ? item.cafe.name : "none"}</span>
        <button onClick={() => void answer("visited")}>answer</button>
      </div>
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // jsdom lacks requestIdleCallback — the hook falls back to setTimeout.
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches lazily once enabled and shows the returned prompt", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ prompt: ITEM }), { status: 200 }),
    );
    render(
      <Wrapper>
        <Hook />
      </Wrapper>,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/navigations/prompt", undefined);
    expect(screen.getByTestId("item").textContent).toBe("Seed Cafe");
  });

  it("never fetches while deferred or for guests (401 → silent)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const { rerender } = render(
      <Wrapper>
        <Hook enabled={false} />
      </Wrapper>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(
      <Wrapper>
        <Hook enabled />
      </Wrapper>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("item").textContent).toBe("none");
  });

  it("consults the queue at most once per session", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ prompt: null }), { status: 200 }),
    );
    const { unmount } = render(
      <Wrapper>
        <Hook />
      </Wrapper>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    unmount();
    render(
      <Wrapper>
        <Hook />
      </Wrapper>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts the answer and enters the check-in flow on visited", async () => {
    const onCheckIn = vi.fn();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: ITEM }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: "visited" }), { status: 200 }));
    render(
      <Wrapper>
        <Hook onCheckIn={onCheckIn} />
      </Wrapper>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "answer" }));
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/navigations/${ITEM.id}/resolve`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(onCheckIn).toHaveBeenCalledWith(ITEM.cafe.id, ITEM.cafe.name);
    expect(screen.getByTestId("item").textContent).toBe("none");
  });

  it("BRAWUKA-281 P2: a wedged SW stops polling after ~5s and still loads the prompt", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ prompt: ITEM }), { status: 200 }),
    );
    const neverActive = { active: { state: "activating" } };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve(neverActive), controller: null },
    });
    render(
      <Wrapper>
        <Hook />
      </Wrapper>,
    );
    // Past the 100×50ms cap the loop must exit and schedule the fetch
    // (fallback setTimeout 1500ms) — 8s covers both legs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/navigations/prompt", undefined);
    expect(screen.getByTestId("item").textContent).toBe("Seed Cafe");
    // No unbounded tail: nothing more fires after another 30s.
    fetchMock.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
  });
});
