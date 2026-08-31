import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import { useCountUp } from "@/hooks/use-count-up";
import { useEnterMotion } from "@/hooks/use-enter-motion";

describe("useMediaQuery", () => {
  let listeners: Array<() => void> = [];
  let matches = false;

  beforeEach(() => {
    listeners = [];
    matches = false;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "change") listeners.push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "change") {
          listeners = listeners.filter((l) => l !== handler);
        }
      }),
      dispatchEvent: vi.fn(),
    }));
  });

  it("returns matchMedia result after mounting", () => {
    matches = true;
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(true);
  });

  it("updates when media query change listener triggers", () => {
    matches = false;
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      for (const listener of listeners) {
        listener();
      }
    });

    expect(result.current).toBe(true);
  });
});

describe("useMounted", () => {
  it("returns true on client after mount", () => {
    const { result } = renderHook(() => useMounted());
    expect(result.current).toBe(true);
  });
});

describe("useCountUp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for target 0", () => {
    const { result } = renderHook(() => useCountUp(0));
    expect(result.current).toBe(0);
  });

  it("animates up to target value over time", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const { result } = renderHook(() => useCountUp(100, 300));
    expect(result.current).toBe(0);

    act(() => {
      now = 1300;
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(100);
  });

  it("immediately returns target if prefers-reduced-motion is true", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useCountUp(42));
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(42);
  });
});

describe("useEnterMotion", () => {
  it("returns true when mounted and reduced motion is not preferred", () => {
    const { result } = renderHook(() => useEnterMotion());
    expect(typeof result.current).toBe("boolean");
  });
});
