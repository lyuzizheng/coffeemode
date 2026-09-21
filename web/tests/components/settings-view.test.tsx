import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsView } from "@/components/settings/settings-view";
import messages from "../../messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// next-themes wants a provider; the theme row only needs a stable value.
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

// AppMenu is a heavy overlay (framer-motion); not under test here.
vi.mock("@/components/layout/app-menu", () => ({
  AppMenu: () => null,
}));

// SignOutButton pulls the server-action module; not under test here.
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => null,
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  // DeleteAccountSection clears the TanStack cache after a successful
  // delete — a bare render without a client throws "No QueryClient set".
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

function renderSettings() {
  return render(<SettingsView initialProfile={null} isAuthenticated />, {
    wrapper: Wrapper,
  });
}

function expandDeleteSection() {
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
}

function armDelete() {
  fireEvent.change(screen.getByPlaceholderText("DELETE"), {
    target: { value: "DELETE" },
  });
}

describe("SettingsView account section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // BRAWUKA-577: the export row must be a plain download anchor — a next/link
  // would prefetch /api/profile/export (a rate-limited full-table read) the
  // moment the row scrolls into view.
  it("renders the export row as a download anchor, not a router link", () => {
    renderSettings();
    const link = screen.getByRole("link", { name: /download my data/i });
    expect(link).toHaveAttribute("href", "/api/profile/export");
    expect(link).toHaveAttribute("download");
  });

  // BRAWUKA-577: Cancel was gated by the same `pending || !armed` prop as
  // Confirm, so it stayed dead until the user typed DELETE.
  it("keeps Cancel live while unarmed and after arming", () => {
    renderSettings();
    expandDeleteSection();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();
    expect(cancel).toBeEnabled();

    armDelete();
    expect(confirm).toBeEnabled();
    expect(cancel).toBeEnabled();

    fireEvent.click(cancel);
    expect(
      screen.getByRole("button", { name: "Delete account" }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("DELETE")).not.toBeInTheDocument();
  });

  // The in-flight gate still freezes both buttons — cancelling the UI while
  // the DELETE request runs would mislead (the request cannot be recalled).
  it("freezes both buttons while the delete request is in flight", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderSettings();
    expandDeleteSection();
    armDelete();
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  });
});
