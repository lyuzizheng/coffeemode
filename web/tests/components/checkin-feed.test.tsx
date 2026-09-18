import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinFeed } from "@/components/discovery/checkin-feed";
import { useCheckinFeed } from "@/components/discovery/use-checkin-feed";
import messages from "../../messages/en.json";
import type { PublicCheckIn } from "@/types/checkins";
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
// The like-failure toast needs a HeroUI provider the tests do not mount.
vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast: vi.fn() };
});
// BRAWUKA-462: a 410 cursor expiry must go straight to the reset state —
// InlineError must never render for it, not even for one frame.
const { inlineErrorSpy } = vi.hoisted(() => ({ inlineErrorSpy: vi.fn() }));
vi.mock("@/components/discovery/inline-error", () => ({
  InlineError: (props: { message: string; onRetry: () => void }) => {
    inlineErrorSpy(props);
    return null;
  },
}));

const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function card(id: string, owned: boolean, note: string): PublicCheckIn {
  return {
    id,
    scores: { wifi: 80, overall: 90 },
    max_stay: "3h",
    note,
    photos: [],
    likes_count: 0,
    liked_by_viewer: false,
    owned_by_viewer: owned,
    visited_at: "2026-08-20T10:00:00.000Z",
    author: null,
  };
}

const OWN_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31";
const OTHER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a32";

function mockFeed() {
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.startsWith(`/api/cafes/${CAFE}/checkins`)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          checkins: [card(OWN_ID, true, "Corner seat"), card(OTHER_ID, false, "Great espresso")],
          next_cursor: null,
        }),
      });
    }
    if (init?.method === "PATCH" || init?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

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

function renderFeed() {
  return render(
    <CheckinFeed cafeId={CAFE} cafeName="Kiosk" onMissingCafe={() => {}} onCheckIn={() => {}} />,
    { wrapper: Wrapper },
  );
}

// BRAWUKA-280: a 410 cursor_version_expired must not trap the feed in a
// retry loop that resends the dead cursor. The hook exposes a retry that
// resets the infinite query so the next request carries no cursor (page one).
describe("CheckinFeed expired-cursor recovery", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("resets the query on retry so page one refetches without the dead cursor", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      seen.push(String(url));
      // Page one issues a live cursor; the snapshot rotates before the next
      // page fetch, so that cursor arrives dead.
      if (seen.length === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ checkins: [card(OWN_ID, true, "Corner seat")], next_cursor: "dead-cursor" }),
        });
      }
      if (seen.length === 2) {
        return Promise.resolve({
          ok: false,
          status: 410,
          json: async () => ({ error: "cursor_version_expired" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ checkins: [card(OWN_ID, true, "Corner seat")], next_cursor: null }),
      });
    });

    function Probe() {
      const { query, retryFromFirstPage } = useCheckinFeed(CAFE, "helpful");
      return (
        <>
          <button type="button" onClick={() => void query.fetchNextPage()}>
            load-next
          </button>
          <button type="button" onClick={() => void retryFromFirstPage()}>
            retry-first-page
          </button>
          <span>{query.data ? "loaded" : "loading"}</span>
          <span>{query.hasNextPage ? "has-next" : "no-next"}</span>
        </>
      );
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={queryClient}>{<Probe />}</QueryClientProvider>
      </NextIntlClientProvider>,
    );

    // The seeded cache carries a dead next-page cursor: the first
    // next-page fetch replays it into a 410, and the exposed retry resets
    // the query so page one refetches with no cursor param.
    await screen.findByText("loaded");
    fireEvent.click(screen.getByRole("button", { name: "load-next" }));
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(seen[1]).toContain("cursor=dead-cursor");
    fireEvent.click(await screen.findByRole("button", { name: "retry-first-page" }));
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(seen[seen.length - 1]).not.toContain("cursor=");
    expect(seen[seen.length - 1]).not.toContain("dead-cursor");
  });

  it("never renders InlineError while the 410 auto-reset runs (BRAWUKA-462)", async () => {
    // Sentinel fires once: the first observe triggers fetchNextPage, which
    // replays the dead cursor into a 410. The hook then auto-resets and
    // refetches page one.
    let fired = false;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: IntersectionObserverCallback) {}
        observe() {
          if (fired) return;
          fired = true;
          queueMicrotask(() =>
            this.cb(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );

    let expired = false;
    const feedCalls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith(`/api/cafes/${CAFE}/checkins`)) {
        feedCalls.push(u);
        if (u.includes("cursor=")) {
          expired = true;
          return Promise.resolve({
            ok: false,
            status: 410,
            json: async () => ({ error: "cursor_version_expired" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            checkins: [card(OWN_ID, true, "Corner seat")],
            next_cursor: expired ? null : "dead-cursor",
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    inlineErrorSpy.mockClear();
    renderFeed();

    // Settle: page one, the 410 next-page hit, then the reset refetch.
    await waitFor(() => expect(feedCalls.length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    await screen.findByText("Corner seat");
    expect(inlineErrorSpy).not.toHaveBeenCalled();
  });
});
// BRAWUKA-450: a 404 means the cafe is gone — the feed must not burn two
// doomed retries before routing to the DG19 gone-cafe flow. The hook's
// retry predicate exempts FeedNotFoundError, so onMissingCafe fires after
// exactly one request.
describe("CheckinFeed gone-cafe 404", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("does not retry a 404 and calls onMissingCafe after one request", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith(`/api/cafes/${CAFE}/checkins`)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: "cafe_not_found" }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    const onMissingCafe = vi.fn();

    render(
      <CheckinFeed cafeId={CAFE} cafeName="Kiosk" onMissingCafe={onMissingCafe} onCheckIn={() => {}} />,
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(onMissingCafe).toHaveBeenCalled(), { timeout: 3000 });
    const feedCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([url]) => String(url).startsWith(`/api/cafes/${CAFE}/checkins`));
    expect(feedCalls).toHaveLength(1);
  });
});


// BRAWUKA-281 P2: a like in flight must disable only its own card's button.
// The hook exposes `likePendingIds` (the in-flight check-in ids);
// rendering passes `likePending={likePendingIds.has(checkin.id)}`.
describe("CheckinFeed per-card like pending", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("liking card A keeps card B's button enabled", async () => {
    let releaseLike!: () => void;
    const likeGate = new Promise<void>((resolve) => {
      releaseLike = resolve;
    });
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith(`/api/cafes/${CAFE}/checkins`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            checkins: [card(OWN_ID, true, "Corner seat"), card(OTHER_ID, false, "Great espresso")],
            next_cursor: null,
          }),
        });
      }
      if (typeof url === "string" && url.includes("/api/checkins/") && url.endsWith("/like")) {
        return likeGate.then(() => ({
          ok: true,
          status: 200,
          json: async () => ({ liked: true, likes_count: 1 }),
        }));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    renderFeed();
    const likeButtons = await screen.findAllByRole("button", { name: "Like this check-in" });
    expect(likeButtons).toHaveLength(2);

    fireEvent.click(likeButtons[0] as HTMLElement);
    await waitFor(() => {
      expect((likeButtons[0] as HTMLButtonElement).disabled).toBe(true);
    });
    // Card B stays interactive while A's like is in flight.
    expect((likeButtons[1] as HTMLButtonElement).disabled).toBe(false);

    releaseLike();
    await waitFor(() => {
      expect((likeButtons[0] as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

// BRAWUKA-460: optimistic like state is keyed per check-in. Concurrent
// likes on different cards must not overwrite each other — pending flags
// track every in-flight like, a failed like rolls back only its own card,
// and a refetch waits for the last like to settle before invalidating.
describe("CheckinFeed concurrent likes", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  function mockLikes(handlers: Record<string, () => unknown>) {
    // The refetch after a settled like must reflect what the server would
    // have persisted — track which ids were liked successfully.
    const liked = new Set<string>();
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith(`/api/cafes/${CAFE}/checkins`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            checkins: [card(OWN_ID, true, "Corner seat"), card(OTHER_ID, false, "Great espresso")].map(
              (c) => (liked.has(c.id) ? { ...c, liked_by_viewer: true, likes_count: 1 } : c),
            ),
            next_cursor: null,
          }),
        });
      }
      for (const [id, handler] of Object.entries(handlers)) {
        if (typeof url === "string" && url === `/api/checkins/${id}/like`) {
          return Promise.resolve(handler()).then((res) => {
            if (typeof res === "object" && res !== null && "ok" in res && res.ok) liked.add(id);
            return res;
          });
        }
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
  }

  it("keeps both cards pending until each like settles", async () => {
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const ok = () => ({
      ok: true,
      status: 200,
      json: async () => ({ liked: true, likes_count: 1 }),
    });
    mockLikes({
      [OWN_ID]: () => gateA.then(ok),
      [OTHER_ID]: () => gateB.then(ok),
    });

    renderFeed();
    const buttons = await screen.findAllByRole("button", { name: "Like this check-in" });
    const btnA = buttons[0] as HTMLButtonElement;
    const btnB = buttons[1] as HTMLButtonElement;

    fireEvent.click(btnA);
    fireEvent.click(btnB);
    await waitFor(() => {
      expect(btnA.disabled).toBe(true);
      expect(btnB.disabled).toBe(true);
    });

    // A settling must not re-enable B while B's like is still in flight.
    releaseA();
    await waitFor(() => expect(btnA.disabled).toBe(false));
    expect(btnB.disabled).toBe(true);

    releaseB();
    await waitFor(() => expect(btnB.disabled).toBe(false));
  });

  it("a failed like rolls back only its own card", async () => {
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    mockLikes({
      [OWN_ID]: () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }),
      [OTHER_ID]: () =>
        gateB.then(() => ({
          ok: true,
          status: 200,
          json: async () => ({ liked: true, likes_count: 1 }),
        })),
    });

    renderFeed();
    const buttons = await screen.findAllByRole("button", { name: "Like this check-in" });
    const btnA = buttons[0] as HTMLButtonElement;
    const btnB = buttons[1] as HTMLButtonElement;

    // A fails fast; B is still in flight with its optimistic like applied.
    fireEvent.click(btnA);
    fireEvent.click(btnB);
    await waitFor(() => {
      expect(btnB.getAttribute("aria-pressed")).toBe("true");
      expect(btnA.getAttribute("aria-pressed")).toBe("false");
    });

    releaseB();
    await waitFor(() => expect(btnB.disabled).toBe(false));
    expect(btnB.getAttribute("aria-pressed")).toBe("true");
  });
});
// DG72 feed-card edit entry (owner verdict BRAWUKA-120): only the viewer's
// own cards expose the overflow menu, opening the drawer prefilled in edit
// mode. jsdom has no IntersectionObserver — the paging sentinel is stubbed.
describe("CheckinFeed own-card edit entry", () => {
  beforeEach(() => {
    mockFeed();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("shows the overflow menu only on the viewer's own card", async () => {
    renderFeed();
    expect(await screen.findByText("Corner seat")).toBeInTheDocument();
    expect(screen.getByText("Great espresso")).toBeInTheDocument();
    const menus = screen.queryAllByRole("button", { name: "More actions for this check-in" });
    expect(menus).toHaveLength(1);
  });

  it("opens the drawer prefilled in edit mode from the own-card menu", async () => {
    renderFeed();
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for this check-in" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit your check-in" }));

    // Edit chrome, prefilled from the feed DTO — not a blank create form.
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

  it("dismisses the menu on Escape", async () => {
    renderFeed();
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for this check-in" }),
    );
    expect(await screen.findByRole("menuitem", { name: "Edit your check-in" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "Edit your check-in" }),
      ).not.toBeInTheDocument();
    });
  });
});

// BRAWUKA-516: the loading skeleton must mirror FeedCard geometry (spec
// 0002 skeleton rule + seo-sharing-v1 §2: 4 cards — meta, chips, note,
// photo strip, action row), not two thin bars.
describe("CheckinFeed skeleton", () => {
  it("renders 4 skeleton cards mirroring real card geometry while pending", () => {
    globalThis.fetch = vi.fn().mockImplementation(() => Promise.withResolvers<Response>().promise);
    renderFeed();

    const cards = document.querySelectorAll('[data-slot="feed-skeleton-card"]');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      // A real card is meta + chips + note + photos + like row (~150–250px),
      // never the old three-bar stub.
      expect(card.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(5);
    }
  });
});
