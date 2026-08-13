import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useActionState } from "react";
import { SignOutButton } from "@/app/auth/sign-out-button";
import messages from "../../messages/en.json";

const clearQueryClientMock = vi.hoisted(() => vi.fn());
const removeClientMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: vi.fn() };
});

vi.mock("@/app/auth/actions", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: clearQueryClientMock }),
}));

vi.mock("@/lib/query/persister", () => ({
  idbPersister: {
    removeClient: removeClientMock,
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("SignOutButton", () => {
  const mockFormAction = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    removeClientMock.mockResolvedValue(undefined);
    vi.mocked(useActionState).mockReturnValue([undefined, mockFormAction, false]);
  });

  it("renders the sign-out button", () => {
    render(<SignOutButton />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: /Sign out/i })).toBeInTheDocument();
  });

  it("shows pending state while the action is running", () => {
    vi.mocked(useActionState).mockReturnValue([undefined, mockFormAction, true]);

    render(<SignOutButton />, { wrapper: Wrapper });

    const button = screen.getByRole("button", { name: /Signing out/i });
    expect(button).toBeDisabled();
  });

  it("displays the localized message for the returned error code", () => {
    vi.mocked(useActionState).mockReturnValue([{ error: "signout_failed" }, mockFormAction, false]);

    render(<SignOutButton />, { wrapper: Wrapper });

    expect(screen.getByRole("alert")).toHaveTextContent("Sign-out didn't complete. Please try again.");
  });

  it("clears the query cache and persisted data, then redirects on success", async () => {
    vi.mocked(useActionState).mockReturnValue([{ success: true }, mockFormAction, false]);

    render(<SignOutButton />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(removeClientMock).toHaveBeenCalledTimes(1);
      expect(clearQueryClientMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });

  it("still redirects when idbPersister.removeClient() rejects", async () => {
    removeClientMock.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(useActionState).mockReturnValue([{ success: true }, mockFormAction, false]);

    render(<SignOutButton />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "sign-out-button: failed to clear persisted cache",
        expect.any(Error),
      );
      expect(clearQueryClientMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/");
    });

    errorSpy.mockRestore();
  });
});
