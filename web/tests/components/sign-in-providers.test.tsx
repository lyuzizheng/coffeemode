import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import React from "react";
import { getAuthProviders } from "@/lib/client-env";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { ProfileGate } from "@/components/profile/profile-gate";

// BRAWUKA-789: the sign-in gates must render exactly the providers enabled
// in `auth.providers` (mirrored as NEXT_PUBLIC_AUTH_PROVIDERS) — unlisted
// providers are absent from the DOM, and the first listed provider is the
// primary CTA. These tests pin that contract without a Supabase config.

// App Router enables Strict Mode by default in development; all component
// tests run under reactStrictMode: true (BRAWUKA-731).
const render = (ui: React.ReactElement) => rtlRender(ui, { reactStrictMode: true });

const LABELS: Record<string, string> = {
  continue_apple: "Continue with Apple",
  continue_google: "Continue with Google",
  signing_in: "Signing in…",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => LABELS[key] ?? `trans_${key}`,
}));

// The server action module pulls next/headers; the submit path is covered by
// http-auth-exchange.integration.test.ts — here only the form payload matters.
vi.mock("@/lib/auth/actions", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// HeroUI Button → plain element exposing the variant contract as data-variant.
vi.mock("@heroui/react", () => ({
  Button: ({ children, variant, type, isDisabled }: Record<string, unknown>) => (
    <button type={type as "submit"} data-variant={variant as string} disabled={isDisabled as boolean}>
      {children as React.ReactNode}
    </button>
  ),
}));

function signInButtons() {
  return screen.getAllByRole("button", { name: /Continue with/i });
}

function names(buttons: HTMLElement[]) {
  return buttons.map((b) => b.textContent);
}

function variants(buttons: HTMLElement[]) {
  return buttons.map((b) => b.getAttribute("data-variant"));
}

describe("getAuthProviders", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
  });

  it("defaults to google only, mirroring app.yaml auth.providers", () => {
    delete process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
    expect(getAuthProviders()).toEqual(["google"]);
  });

  it("parses the ordered list, keeps first entry primary order", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "apple,google";
    expect(getAuthProviders()).toEqual(["apple", "google"]);
  });

  it("drops unknown ids and duplicates", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "github,google,google";
    expect(getAuthProviders()).toEqual(["google"]);
  });

  it("falls back to google when nothing valid remains", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "github";
    expect(getAuthProviders()).toEqual(["google"]);
  });
});

describe("sign-in gates render enabled providers only", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
  });

  it("google-only config: SignInGate renders one primary Google button, no Apple", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "google";
    render(<SignInGate message="msg" next="/profile" />);

    const buttons = signInButtons();
    expect(names(buttons)).toEqual(["Continue with Google"]);
    expect(variants(buttons)).toEqual(["primary"]);
    expect(screen.queryByRole("button", { name: /Apple/i })).not.toBeInTheDocument();
    // The OAuth payload travels as a hidden form field on the server action.
    const providerInput = document.querySelector('input[name="provider"]');
    expect(providerInput).toHaveAttribute("value", "google");
  });

  it("google-only config: ProfileGate renders one primary Google button, no Apple", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "google";
    render(<ProfileGate />);

    const buttons = signInButtons();
    expect(names(buttons)).toEqual(["Continue with Google"]);
    expect(variants(buttons)).toEqual(["primary"]);
    expect(screen.queryByRole("button", { name: /Apple/i })).not.toBeInTheDocument();
  });

  it("apple re-enabled: both gates render both buttons, first listed is primary", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "apple,google";
    const { unmount } = render(<SignInGate message="msg" />);

    let buttons = signInButtons();
    expect(names(buttons)).toEqual(["Continue with Apple", "Continue with Google"]);
    expect(variants(buttons)).toEqual(["primary", "outline"]);
    unmount();

    render(<ProfileGate />);
    buttons = signInButtons();
    expect(names(buttons)).toEqual(["Continue with Apple", "Continue with Google"]);
    expect(variants(buttons)).toEqual(["primary", "outline"]);
  });

  it("google-first ordering makes Google the primary when both are enabled", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "google,apple";
    render(<SignInGate message="msg" />);

    const buttons = signInButtons();
    expect(names(buttons)).toEqual(["Continue with Google", "Continue with Apple"]);
    expect(variants(buttons)).toEqual(["primary", "outline"]);
  });
});
