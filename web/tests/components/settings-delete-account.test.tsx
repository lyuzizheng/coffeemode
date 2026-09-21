import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DeleteAccountSection } from "@/components/settings/settings-view";
import { UNAUTHORIZED } from "@/lib/http";
import messages from "../../messages/en.json";

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const clearQueryClientMock = vi.hoisted(() => vi.fn());
const removeClientMock = vi.hoisted(() => vi.fn());
const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: clearQueryClientMock }),
}));

vi.mock("@/lib/query/persister", () => ({
  idbPersister: { removeClient: removeClientMock },
}));

// Keep the real isUnauthorized/UNAUTHORIZED contract; only the transport is faked.
vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock("@/lib/auth/actions", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeleteAccountSection />
    </NextIntlClientProvider>,
  );
}

function armAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
}

describe("DeleteAccountSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    removeClientMock.mockResolvedValue(undefined);
    apiFetchMock.mockResolvedValue({});
  });

  it("keeps the confirm disabled until DELETE is typed", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
  });

  it("clears the persisted cache and query client after a successful delete", async () => {
    renderSection();
    armAndConfirm();

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/profile", { method: "DELETE" });
      expect(removeClientMock).toHaveBeenCalledTimes(1);
      expect(clearQueryClientMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/");
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("still navigates when the persisted-cache wipe fails", async () => {
    removeClientMock.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderSection();
    armAndConfirm();

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "settings-view: failed to clear persisted cache",
        expect.any(Error),
      );
      expect(clearQueryClientMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    errorSpy.mockRestore();
  });

  it("shows the error and keeps the cache untouched when the API fails", async () => {
    apiFetchMock.mockRejectedValue(new Error("server_error"));

    renderSection();
    armAndConfirm();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");
    });
    expect(removeClientMock).not.toHaveBeenCalled();
    expect(clearQueryClientMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("swaps to the sign-in gate when the session expired mid-flow", async () => {
    apiFetchMock.mockRejectedValue(new Error(UNAUTHORIZED));

    renderSection();
    armAndConfirm();

    await waitFor(() => {
      expect(
        screen.getByText("Sign in to manage your account"),
      ).toBeInTheDocument();
    });
    expect(removeClientMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
