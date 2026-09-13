import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { MotionValue } from "framer-motion";
import type { DiscoveryController, SheetSnap } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import { spring } from "@/lib/motion";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import messages from "../../messages/en.json";

let mockReducedMotion = false;

const animateCalls: Array<{
  motionValue: MotionValue<number>;
  target: number;
  transition: unknown;
}> = [];

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => mockReducedMotion,
    animate: ((...args: Parameters<typeof actual.animate>) => {
      const [motionValue, target, transition] = args;
      animateCalls.push({
        motionValue: motionValue as MotionValue<number>,
        target: target as number,
        transition,
      });
      return actual.animate(...args);
    }) as typeof actual.animate,
  };
});

import { MobileSheet } from "@/components/discovery/mobile-sheet";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={messages}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  };
}

const mockCafe: CafeSummary = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Common Man Coffee Roasters",
  lat: 1.29027,
  lng: 103.851959,
  address: "22 Martin Rd",
  city: "singapore",
  tz: "Asia/Singapore",
  opening_hours: null,
  price_range: 2,
  cover: "/card/test.webp",
  distance_m: 250,
  maintained_by_service: false,
  work_stats: {
    ...emptyWorkStats(),
    n_users: 1,
    n_checkins: 1,
    composite_score: 85,
    experience_score: 88,
    dims: {
      ...emptyWorkStats().dims,
      wifi: { sum: 80, n: 1 },
    },
    policies: {
      max_stay: { "2h": 1 },
    },
  },
};

function getDragEndHandler(element: HTMLElement) {
  const reactKey = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
  if (!reactKey) throw new Error("React fiber not found");
  let curr = (element as unknown as Record<string, unknown>)[reactKey] as Record<string, unknown> | null;
  while (curr) {
    if (curr.memoizedProps && typeof (curr.memoizedProps as Record<string, unknown>).onDragEnd === "function") {
      return (curr.memoizedProps as Record<string, unknown>).onDragEnd as (
        event: unknown,
        info: { offset: { y: number }; velocity: { y: number } },
      ) => void;
    }
    curr = curr.return as Record<string, unknown> | null;
  }
  throw new Error("onDragEnd handler not found on motion fiber");
}

/**
 * Reads the target of the snap effect's mount-time animate call — the sheet's
 * initial detent — and clears the log. The value comes from the component, not
 * from a re-derivation of its layout constants, and it is consumed BEFORE the
 * interaction under test, so a later assertion can only be satisfied by a new
 * animate call to that detent.
 */
function consumeMountDetentY(): number {
  const mountCall = animateCalls[animateCalls.length - 1];
  if (!mountCall) throw new Error("snap effect emitted no animate call on mount");
  animateCalls.length = 0;
  return mountCall.target;
}

/** A transition's start velocity; an omitted field means "starts from rest". */
function startVelocity(transition: unknown): number {
  return (transition as { velocity?: number } | undefined)?.velocity ?? 0;
}

describe("MobileSheet drag and snap behavior (BRAWUKA-135)", () => {
  beforeEach(() => {
    mockReducedMotion = false;
    animateCalls.length = 0;
    window.innerHeight = 800;
  });

  it("Gap 2: sub-threshold drag at HALF animates y back to offsets.half with snappy spring", () => {
    const controller: DiscoveryController = {
      selectedCafeId: mockCafe.id,
      snap: "half",
      select: vi.fn(),
      snapTo: vi.fn(),
      close: vi.fn(),
      handleMissingCafe: vi.fn(),
      registerCardRef: vi.fn(),
      detailHeadingRef: vi.fn(),
    };

    render(
      <MobileSheet
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: createWrapper() },
    );

    const sheet = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    const onDragEnd = getDragEndHandler(sheet);

    // The sheet's own mount-time snap fixes the HALF detent this drag must return to.
    const detentY = consumeMountDetentY();

    // Sub-threshold drag: offset = 30px (<= 60), velocity = 100px/s (<= 300)
    act(() => {
      onDragEnd(null, { offset: { y: 30 }, velocity: { y: 100 } });
    });

    // Detent did not change: animate MUST be called to return y to that detent.
    const returnAnim = animateCalls.find((call) => call.target === detentY);
    expect(returnAnim).toBeDefined();
    expect(returnAnim?.transition).toEqual(spring.snappy);
  });

  it("Gap 2: sub-threshold drag at PEEK animates y back to offsets.peek with snappy spring", () => {
    const controller: DiscoveryController = {
      selectedCafeId: null,
      snap: "peek",
      select: vi.fn(),
      snapTo: vi.fn(),
      close: vi.fn(),
      handleMissingCafe: vi.fn(),
      registerCardRef: vi.fn(),
      detailHeadingRef: vi.fn(),
    };

    render(
      <MobileSheet
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: createWrapper() },
    );

    const sheet = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    const onDragEnd = getDragEndHandler(sheet);

    // The sheet's own mount-time snap fixes the PEEK detent this drag must return to.
    const detentY = consumeMountDetentY();

    // Sub-threshold drag: offset = 25px (<= 60), velocity = 80px/s (<= 300)
    act(() => {
      onDragEnd(null, { offset: { y: 25 }, velocity: { y: 80 } });
    });

    const returnAnim = animateCalls.find((call) => call.target === detentY);
    expect(returnAnim).toBeDefined();
    expect(returnAnim?.transition).toEqual(spring.snappy);
  });

  it("Gap 2: sub-threshold drag with prefers-reduced-motion snaps instantly with duration: 0", () => {
    mockReducedMotion = true;
    const controller: DiscoveryController = {
      selectedCafeId: mockCafe.id,
      snap: "half",
      select: vi.fn(),
      snapTo: vi.fn(),
      close: vi.fn(),
      handleMissingCafe: vi.fn(),
      registerCardRef: vi.fn(),
      detailHeadingRef: vi.fn(),
    };

    render(
      <MobileSheet
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: createWrapper() },
    );

    const sheet = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    const onDragEnd = getDragEndHandler(sheet);

    // The sheet's own mount-time snap fixes the HALF detent this drag must return to.
    const detentY = consumeMountDetentY();

    act(() => {
      onDragEnd(null, { offset: { y: 35 }, velocity: { y: 120 } });
    });

    const returnAnim = animateCalls.find((call) => call.target === detentY);
    expect(returnAnim).toBeDefined();
    expect(returnAnim?.transition).toEqual({ duration: 0 });
  });

  it("Gap 1: sub-threshold drag does not leak stale velocity into subsequent programmatic snap", () => {
    let currentSnap: SheetSnap = "half";
    const controller: DiscoveryController = {
      selectedCafeId: mockCafe.id,
      get snap() {
        return currentSnap;
      },
      select: vi.fn(),
      snapTo: vi.fn((next) => {
        currentSnap = next;
      }),
      close: vi.fn(),
      handleMissingCafe: vi.fn(),
      registerCardRef: vi.fn(),
      detailHeadingRef: vi.fn(),
    };

    const wrapper = createWrapper();
    const { rerender } = render(
      <MobileSheet
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper },
    );

    const sheet = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    const onDragEnd = getDragEndHandler(sheet);

    // Sub-threshold drag with velocity 250 px/s
    act(() => {
      onDragEnd(null, { offset: { y: 20 }, velocity: { y: 250 } });
    });

    animateCalls.length = 0;

    // Next programmatic snap: e.g. user triggers snapTo("full")
    currentSnap = "full";
    act(() => {
      rerender(
        <MobileSheet
          controller={controller}
          cafes={[mockCafe]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          onCheckIn={vi.fn()}
          addCafe={<span>Add Cafe</span>}
        />,
      );
    });

    // Programmatic snap animation must start from rest (velocity = 0), not with the stale 250px/s.
    // The contract is the snappy token plus a rest start — not whether `velocity`
    // is present on the transition object (omitting it is behaviourally 0).
    const fullAnim = animateCalls.find((call) => call.target === 0);
    expect(fullAnim).toBeDefined();
    expect(fullAnim?.transition).toMatchObject(spring.snappy);
    expect(startVelocity(fullAnim?.transition)).toBe(0);
  });

  it("supra-threshold drag hands off release velocity to the detent snap effect", () => {
    let currentSnap: SheetSnap = "half";
    const controller: DiscoveryController = {
      selectedCafeId: mockCafe.id,
      get snap() {
        return currentSnap;
      },
      select: vi.fn(),
      snapTo: vi.fn((next) => {
        currentSnap = next;
      }),
      close: vi.fn(),
      handleMissingCafe: vi.fn(),
      registerCardRef: vi.fn(),
      detailHeadingRef: vi.fn(),
    };

    const wrapper = createWrapper();
    const { rerender } = render(
      <MobileSheet
        controller={controller}
        cafes={[mockCafe]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper },
    );

    const sheet = screen.getByRole("region", { name: messages.discovery.sheet_aria });
    const onDragEnd = getDragEndHandler(sheet);

    // The sheet's own mount-time snap fixes the HALF detent the later
    // programmatic snap must return to.
    const halfDetentY = consumeMountDetentY();

    // Supra-threshold upward flick: velocity = -400 px/s (< -STEP_VELOCITY), offset = -70px (< -STEP_OFFSET_PX)
    // Steps: ["peek", "half", "full"]. Current index is 1 (half). Next is 2 (full).
    act(() => {
      onDragEnd(null, { offset: { y: -70 }, velocity: { y: -400 } });
    });

    // Controller was called with target = full
    expect(controller.snapTo).toHaveBeenCalledWith("full");

    // Trigger re-render with the updated snap
    act(() => {
      rerender(
        <MobileSheet
          controller={controller}
          cafes={[mockCafe]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          onCheckIn={vi.fn()}
          addCafe={<span>Add Cafe</span>}
        />,
      );
    });

    // Snap effect consumed velocity -400
    const fullAnim = animateCalls.find((call) => call.target === 0);
    expect(fullAnim).toBeDefined();
    expect(fullAnim?.transition).toMatchObject(spring.snappy);
    expect(startVelocity(fullAnim?.transition)).toBe(-400);

    // A subsequent programmatic snap after that must start from rest (velocity = 0)
    animateCalls.length = 0;
    currentSnap = "half";
    act(() => {
      rerender(
        <MobileSheet
          controller={controller}
          cafes={[mockCafe]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          onCheckIn={vi.fn()}
          addCafe={<span>Add Cafe</span>}
        />,
      );
    });

    const halfAnim = animateCalls.find((call) => call.target === halfDetentY);
    expect(halfAnim).toBeDefined();
    expect(halfAnim?.transition).toMatchObject(spring.snappy);
    expect(startVelocity(halfAnim?.transition)).toBe(0);
  });
});

describe("MobileSheet peek strip error branch (BRAWUKA-231)", () => {
  beforeEach(() => {
    mockReducedMotion = false;
    animateCalls.length = 0;
    window.innerHeight = 800;
  });

  it("renders inline error with Retry instead of the empty state when the cafes query fails", () => {
    const onRetry = vi.fn();
    render(
      <MobileSheet
        controller={{
          selectedCafeId: null,
          snap: "peek",
          select: vi.fn(),
          snapTo: vi.fn(),
          close: vi.fn(),
          handleMissingCafe: vi.fn(),
          registerCardRef: vi.fn(),
          detailHeadingRef: vi.fn(),
        }}
        cafes={[]}
        isLoading={false}
        isError
        onRetry={onRetry}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load nearby cafes");
    expect(screen.queryByText("No cafes nearby yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty state for a genuine empty result (no error)", () => {
    render(
      <MobileSheet
        controller={{
          selectedCafeId: null,
          snap: "peek",
          select: vi.fn(),
          snapTo: vi.fn(),
          close: vi.fn(),
          handleMissingCafe: vi.fn(),
          registerCardRef: vi.fn(),
          detailHeadingRef: vi.fn(),
        }}
        cafes={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onCheckIn={vi.fn()}
        addCafe={<span>Add Cafe</span>}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText("No cafes nearby yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
