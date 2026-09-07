import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PublicIdentityToggle } from "@/components/profile/public-identity-toggle";
import type { UserProfileDto } from "@/lib/db/profile";
import messages from "../../messages/en.json";

const baseProfile: UserProfileDto = {
  id: "user-1",
  displayName: "Coffee Lover",
  currentCity: "singapore",
  avatarUrl: null,
  createdAt: new Date().toISOString(),
  showPublicIdentity: false,
  publicHandle: null,
  identityConsentedAt: null,
  publicHandleChangedAt: null,
};

function renderToggle(profile: UserProfileDto, onProfileChange: (p: UserProfileDto) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PublicIdentityToggle profile={profile} onProfileChange={onProfileChange} />
    </NextIntlClientProvider>,
  );
}

describe("PublicIdentityToggle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders unchecked with the ratified copy when opted out", () => {
    renderToggle(baseProfile, vi.fn());

    expect(
      screen.getByText("Don't show my name on cafes I create or check-ins I post"),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("opts in with an optimistic update and PATCHes showPublicIdentity", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        showPublicIdentity: true,
        publicHandle: "coffee-lover-ab12",
        identityConsentedAt: "2026-09-07T00:00:00.000Z",
        publicHandleChangedAt: null,
      }),
    } as Response);
    const onProfileChange = vi.fn();

    renderToggle(baseProfile, onProfileChange);
    fireEvent.click(screen.getByRole("switch"));

    // Optimistic update lands before the network round-trip resolves.
    expect(onProfileChange).toHaveBeenCalledWith(
      expect.objectContaining({ showPublicIdentity: true }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/profile/identity",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ showPublicIdentity: true }),
      }),
    );

    await waitFor(() => {
      expect(onProfileChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          showPublicIdentity: true,
          publicHandle: "coffee-lover-ab12",
        }),
      );
    });
  });

  it("reverts and maps handle_taken to copy when the handle save fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "handle_taken", message: "taken" }),
    } as Response);
    const onProfileChange = vi.fn();

    renderToggle({ ...baseProfile, showPublicIdentity: true }, onProfileChange);
    fireEvent.click(screen.getByRole("button", { name: "Public handle" }));
    fireEvent.change(screen.getByPlaceholderText(/lowercase/), {
      target: { value: "already-taken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("That handle is already taken");
    });
    // The failed save rolls back to the pre-submit profile.
    expect(onProfileChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ showPublicIdentity: true }),
    );
  });

  it("shows the generic copy on network failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const onProfileChange = vi.fn();

    renderToggle(baseProfile, onProfileChange);
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save — try again?");
    });
    expect(onProfileChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ showPublicIdentity: false }),
    );
  });
});
