import { act, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cafeIdFromPath,
  useDiscoveryController,
} from "@/lib/discovery/use-discovery-controller";
import en from "@/messages/en.json";

vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast: vi.fn() };
});

import { toast } from "@heroui/react";

const CAFE_1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";
const CAFE_2 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {children}
    </NextIntlClientProvider>
  );
}

function setup() {
  return renderHook(() => useDiscoveryController(), { wrapper });
}

/** Simulate the browser landing on `path` via Back/Forward. */
function firePopstate(path: string) {
  window.history.replaceState(null, "", path);
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("cafeIdFromPath", () => {
  it("parses /cafes/<uuid> and rejects everything else", () => {
    expect(cafeIdFromPath(`/cafes/${CAFE_1}`)).toBe(CAFE_1);
    expect(cafeIdFromPath("/")).toBeNull();
    expect(cafeIdFromPath("/cafes/not-a-uuid")).toBeNull();
    expect(cafeIdFromPath("/cafes")).toBeNull();
  });
});

describe("useDiscoveryController URL sync (DG14)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    vi.mocked(toast).mockClear();
  });

  it("starts unselected at PEEK", () => {
    const { result } = setup();
    expect(result.current.selectedCafeId).toBeNull();
    expect(result.current.snap).toBe("peek");
  });

  it("first selection pushes one entry; a second selection replaces it", () => {
    const { result } = setup();
    const before = window.history.length;
    act(() => result.current.select(CAFE_1));
    expect(result.current.selectedCafeId).toBe(CAFE_1);
    expect(result.current.snap).toBe("half");
    expect(window.location.pathname).toBe(`/cafes/${CAFE_1}`);
    expect(window.history.length).toBe(before + 1);

    act(() => result.current.select(CAFE_2));
    expect(window.location.pathname).toBe(`/cafes/${CAFE_2}`);
    expect(window.history.length).toBe(before + 1); // replaced, not pushed
  });

  it("snap changes replace the entry; stepping into PEEK clears selection", () => {
    const { result } = setup();
    act(() => result.current.select(CAFE_1));
    const len = window.history.length;
    act(() => result.current.snapTo("full"));
    expect(result.current.snap).toBe("full");
    expect(window.history.length).toBe(len);

    act(() => result.current.snapTo("peek"));
    expect(result.current.selectedCafeId).toBeNull();
    expect(result.current.snap).toBe("peek");
    expect(window.location.pathname).toBe("/");
  });

  it("close() replaces the URL with / and clears selection", () => {
    const { result } = setup();
    act(() => result.current.select(CAFE_1));
    const len = window.history.length;
    act(() => result.current.close());
    expect(result.current.selectedCafeId).toBeNull();
    expect(window.location.pathname).toBe("/");
    expect(window.history.length).toBe(len); // no extra entry
  });

  it("Back to / collapses the session; Forward to /cafes/<id> re-selects", () => {
    const { result } = setup();
    act(() => result.current.select(CAFE_1));
    firePopstate("/");
    expect(result.current.selectedCafeId).toBeNull();
    expect(result.current.snap).toBe("peek");

    const len = window.history.length;
    firePopstate(`/cafes/${CAFE_2}`);
    expect(result.current.selectedCafeId).toBe(CAFE_2);
    expect(result.current.snap).toBe("half");
    expect(window.history.length).toBe(len); // no loop push
  });

  it("handleMissingCafe toasts and clears the selection (DG19)", () => {
    const { result } = setup();
    act(() => result.current.select(CAFE_1));
    act(() => result.current.handleMissingCafe());
    expect(toast).toHaveBeenCalledWith(en.discovery.missing_cafe, { timeout: 4000 });
    expect(result.current.selectedCafeId).toBeNull();
    expect(window.location.pathname).toBe("/");
  });
});
