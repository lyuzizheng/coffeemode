import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useActionState } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
import messages from "../../messages/en.json";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: vi.fn() };
});

vi.mock("@/lib/auth/actions", () => ({
  signIn: vi.fn(),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("SignInButton", () => {
  const mockFormAction = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useActionState).mockReturnValue([undefined, mockFormAction, false]);
  });

  it("renders the Apple button with a hidden provider input", () => {
    render(<SignInButton provider="apple" variant="primary" />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: /Continue with Apple/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("apple")).toHaveAttribute("type", "hidden");
  });

  it("renders the Google button", () => {
    render(<SignInButton provider="google" variant="outline" />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
  });

  it("shows pending state while the action is running", () => {
    vi.mocked(useActionState).mockReturnValue([undefined, mockFormAction, true]);

    render(<SignInButton provider="google" variant="outline" />, { wrapper: Wrapper });

    const button = screen.getByRole("button", { name: /Signing in/i });
    expect(button).toBeDisabled();
  });

  it("displays the localized message for the returned error code", () => {
    vi.mocked(useActionState).mockReturnValue([{ error: "provider_start_failed" }, mockFormAction, false]);

    render(<SignInButton provider="apple" variant="primary" />, { wrapper: Wrapper });

    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in couldn't start. Please try again.");
  });
});
