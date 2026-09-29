import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignOutButton } from "@/components/auth/sign-out-button";

// BRAWUKA-732: a successful sign-out must drop the persisted query store and
// the live client before navigating — and a rejected IndexedDB removal must
// not leave the session's cache behind or block the navigation.

const render = (ui: React.ReactElement) => rtlRender(ui, { reactStrictMode: true });

const mockPush = vi.fn();
const mockRemoveClient = vi.fn<() => Promise<void>>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `trans_${key}`,
}));

vi.mock("@/lib/auth/actions", () => ({
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/lib/query/persister", () => ({
  idbPersister: {
    removeClient: (...args: unknown[]) => mockRemoveClient(...(args as [])),
  },
}));

vi.mock("@heroui/react", () => ({
  Button: ({ children, type, isDisabled }: Record<string, unknown>) => (
    <button type={type as "submit"} disabled={isDisabled as boolean}>
      {children as React.ReactNode}
    </button>
  ),
}));

import { signOut } from "@/lib/auth/actions";

function renderButton(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SignOutButton />
    </QueryClientProvider>,
  );
}

async function submit() {
  const button = screen.getByRole("button");
  const form = button.closest("form");
  if (!form) throw new Error("SignOutButton did not render a form");
  fireEvent.submit(form);
}

describe("SignOutButton teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveClient.mockResolvedValue(undefined);
    vi.mocked(signOut).mockResolvedValue({ success: true });
  });
  it("drops the persisted cache and the live client, then navigates home", async () => {
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, "clear");
    renderButton(queryClient);

    await submit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockRemoveClient).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("still clears the live client and navigates when persisted removal fails", async () => {
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, "clear");
    mockRemoveClient.mockRejectedValue(new Error("idb unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderButton(queryClient);

    await submit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(clearSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "sign-out-button: failed to clear persisted cache",
      expect.any(Error),
    );
  });
});
