import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AuthCallbackError } from "@/components/auth/auth-callback-error";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("AuthCallbackError", () => {
  it("renders the generic message in an alert role", () => {
    render(<AuthCallbackError />, { wrapper: Wrapper });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in didn't go through. Please try again.",
    );
  });

  it("maps reason=profile_upsert to its specific variant", () => {
    render(<AuthCallbackError reason="profile_upsert" />, { wrapper: Wrapper });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "profile setup didn't finish",
    );
  });

  it("falls back to the generic message for unknown reasons", () => {
    render(<AuthCallbackError reason="something_else" />, { wrapper: Wrapper });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in didn't go through. Please try again.",
    );
  });
});
