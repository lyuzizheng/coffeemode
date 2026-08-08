import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useActionState } from "react";
import { SignOutButton } from "@/app/auth/sign-out-button";
import messages from "../../messages/en.json";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: vi.fn() };
});

vi.mock("@/app/auth/actions", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
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

  it("displays the returned error message", () => {
    vi.mocked(useActionState).mockReturnValue([{ error: "Sign-out failed" }, mockFormAction, false]);

    render(<SignOutButton />, { wrapper: Wrapper });

    expect(screen.getByRole("alert")).toHaveTextContent("Sign-out failed");
  });
});
