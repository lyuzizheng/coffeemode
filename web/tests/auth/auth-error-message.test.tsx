import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AuthErrorMessage } from "@/app/auth/auth-error-message";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("AuthErrorMessage", () => {
  it("renders nothing without an error", () => {
    const { container } = render(<AuthErrorMessage />, { wrapper: Wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("maps each known code to its localized copy", () => {
    const cases = [
      ["invalid_provider", "That sign-in method isn't available."],
      ["not_configured", "Sign-in isn't set up yet. Check back soon."],
      ["provider_start_failed", "Sign-in couldn't start. Please try again."],
      ["signout_failed", "Sign-out didn't complete. Please try again."],
    ] as const;
    for (const [code, copy] of cases) {
      const { unmount } = render(<AuthErrorMessage error={code} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByRole("alert")).toHaveTextContent(copy);
      unmount();
    }
  });

  it("falls back to the generic copy for unknown values — never raw text", () => {
    render(<AuthErrorMessage error="OAuth provider unavailable" />, {
      wrapper: Wrapper,
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
    expect(alert).not.toHaveTextContent("OAuth provider unavailable");
  });
});
