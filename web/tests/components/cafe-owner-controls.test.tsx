import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CafeOwnerControls } from "@/components/cafe/cafe-owner-controls";

// BRAWUKA-732: cafe delete refreshes the shared check-in invalidation set —
// including the persisted "cafes-list" key — exactly once each.

const render = (ui: React.ReactElement) => rtlRender(ui, { reactStrictMode: true });

const mockRefresh = vi.fn();
const mockApiFetch = vi.fn<(url: string, init?: unknown) => Promise<unknown>>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `trans_${key}:${JSON.stringify(params)}` : `trans_${key}`,
}));

vi.mock("@/lib/http", () => ({
  apiFetch: (...args: [string, unknown?]) => mockApiFetch(...args),
  ApiError: class ApiError extends Error {
    declare status: number;
    declare code?: string;
    declare details?: Record<string, unknown>;
  },
  isUnauthorized: () => false,
}));

vi.mock("@heroui/react", () => {
  const Switch = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    toast: vi.fn(),
    Label: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Switch: Object.assign(Switch, {
      Content: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
      Control: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
      Thumb: () => null,
    }),
    Button: ({ children, onPress, isDisabled }: Record<string, unknown>) => (
      <button
        onClick={onPress as () => void}
        disabled={isDisabled as boolean}
      >
        {children as React.ReactNode}
      </button>
    ),
  };
});

vi.mock("@/components/auth/sign-in-gate", () => ({
  SignInGate: () => null,
}));

function renderControls(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <CafeOwnerControls cafeId="cafe-1" initialVisibility="public" hasCheckins />
    </QueryClientProvider>,
  );
}

describe("CafeOwnerControls delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({});
  });

  it("issues an unconfirmed DELETE and refreshes each affected key exactly once", async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    renderControls(queryClient);

    fireEvent.click(screen.getByRole("button", { name: "trans_delete_cafe" }));
    fireEvent.click(screen.getByRole("button", { name: "trans_delete" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/cafes/cafe-1", { method: "DELETE" });

    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([
      ["cafe", "cafe-1"],
      ["cafe-checkins", "cafe-1"],
      ["last-checkin", "cafe-1"],
      ["profile"],
      ["cafes-list"],
    ]);
  });
});
