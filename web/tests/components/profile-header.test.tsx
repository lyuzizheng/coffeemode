import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProfileHeader, isSameOriginReferrer } from "@/components/profile/profile-header";
import messages from "../../messages/en.json";

const pushMock = vi.fn();
const backMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    back: backMock,
    refresh: vi.fn(),
  }),
  usePathname: () => "/profile",
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("ProfileHeader & isSameOriginReferrer (BRAWUKA-584)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(document, "referrer", {
      value: "",
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.history, "length", {
      value: 1,
      writable: true,
      configurable: true,
    });
  });

  describe("isSameOriginReferrer", () => {
    it("returns false when referrer is empty", () => {
      Object.defineProperty(document, "referrer", { value: "", configurable: true });
      expect(isSameOriginReferrer()).toBe(false);
    });

    it("returns false when referrer is cross-origin", () => {
      Object.defineProperty(document, "referrer", {
        value: "https://www.google.com/search?q=coffeemode",
        configurable: true,
      });
      expect(isSameOriginReferrer()).toBe(false);
    });

    it("returns false for attacker domain mimicking origin", () => {
      Object.defineProperty(document, "referrer", {
        value: `${window.location.origin}.attacker.com/profile`,
        configurable: true,
      });
      expect(isSameOriginReferrer()).toBe(false);
    });

    it("returns false for invalid referrer URL", () => {
      Object.defineProperty(document, "referrer", {
        value: "not-a-valid-url:::",
        configurable: true,
      });
      expect(isSameOriginReferrer()).toBe(false);
    });

    it("returns true when referrer shares exact origin", () => {
      Object.defineProperty(document, "referrer", {
        value: `${window.location.origin}/cafes/test-cafe`,
        configurable: true,
      });
      expect(isSameOriginReferrer()).toBe(true);
    });

    it("returns true for same-origin relative referrer", () => {
      Object.defineProperty(document, "referrer", {
        value: "/settings",
        configurable: true,
      });
      expect(isSameOriginReferrer()).toBe(true);
    });
  });

  describe("ProfileHeader back button navigation", () => {
    it("calls router.back() when history.length > 1 and referrer is same-origin", () => {
      Object.defineProperty(window.history, "length", { value: 3, configurable: true });
      Object.defineProperty(document, "referrer", {
        value: `${window.location.origin}/cafes/cafe-1`,
        configurable: true,
      });

      render(<ProfileHeader isAuthenticated={false} />, { wrapper: Wrapper });

      const backButton = screen.getByRole("button", { name: messages.profile.back });
      fireEvent.click(backButton);

      expect(backMock).toHaveBeenCalledTimes(1);
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("falls back to router.push('/') when referrer is cross-origin even if history.length > 1", () => {
      Object.defineProperty(window.history, "length", { value: 5, configurable: true });
      Object.defineProperty(document, "referrer", {
        value: "https://www.google.com/",
        configurable: true,
      });

      render(<ProfileHeader isAuthenticated={false} />, { wrapper: Wrapper });

      const backButton = screen.getByRole("button", { name: messages.profile.back });
      fireEvent.click(backButton);

      expect(backMock).not.toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith("/");
    });

    it("falls back to router.push('/') when referrer is empty even if history.length > 1", () => {
      Object.defineProperty(window.history, "length", { value: 2, configurable: true });
      Object.defineProperty(document, "referrer", { value: "", configurable: true });

      render(<ProfileHeader isAuthenticated={false} />, { wrapper: Wrapper });

      const backButton = screen.getByRole("button", { name: messages.profile.back });
      fireEvent.click(backButton);

      expect(backMock).not.toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith("/");
    });

    it("falls back to router.push('/') when history.length <= 1 even if referrer is same-origin", () => {
      Object.defineProperty(window.history, "length", { value: 1, configurable: true });
      Object.defineProperty(document, "referrer", {
        value: `${window.location.origin}/settings`,
        configurable: true,
      });

      render(<ProfileHeader isAuthenticated={false} />, { wrapper: Wrapper });

      const backButton = screen.getByRole("button", { name: messages.profile.back });
      fireEvent.click(backButton);

      expect(backMock).not.toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
