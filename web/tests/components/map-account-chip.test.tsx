import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MapAccountChip } from "@/components/map/map-account-chip";
import messages from "../../messages/en.json";

function renderChip(accountInitial?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MapAccountChip accountInitial={accountInitial} />
    </NextIntlClientProvider>,
  );
}

describe("MapAccountChip (BRAWUKA-318)", () => {
  it("signed-in: the avatar initial links to /profile", () => {
    renderChip("J");
    const link = screen.getByRole("link", { name: "Profile" });
    expect(link).toHaveAttribute("href", "/profile");
    expect(link).toHaveTextContent("J");
  });

  it("signed-out: a sign-in affordance links to /profile (the gate there carries the providers)", () => {
    renderChip();
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("always exposes the theme toggle", () => {
    renderChip();
    // BRAWUKA-372: single cycling icon button, not a segmented group.
    expect(screen.getByRole("button", { name: /Theme/ })).toBeInTheDocument();
  });
});
