import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { HashSessionBridge } from "@/components/auth/hash-session-bridge";

/**
 * BRAWUKA-956: magic links verified by Supabase's hosted `/auth/v1/verify`
 * land with the session in the URL hash (`#access_token=…&refresh_token=…`),
 * which never reaches the server. The bridge is the only thing that turns that
 * fragment into a session cookie — by posting it to `/api/auth/session` — so
 * these are its contracts: exchange, clear, fail loudly on half a session, and
 * stay inert on a normal page load.
 */

const mockRefresh = vi.fn();
const mockReplace = vi.fn();
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean }>>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, replace: mockReplace }),
}));

/** Put the jsdom document at `path` — the landing URL the browser really gets. */
function landOn(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  mockRefresh.mockReset();
  mockReplace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  landOn("/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HashSessionBridge", () => {
  it("exchanges the magic-link hash for a session, then clears the fragment", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    landOn("/#access_token=token-abc&refresh_token=refresh-abc");

    render(<HashSessionBridge />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/session");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ access_token: "token-abc", refresh_token: "refresh-abc" }),
    });
    // Tokens must not stay in the address bar, history, or any later referrer.
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does nothing when the landing URL carries no access token", async () => {
    render(<HashSessionBridge />);
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("clears a half-session fragment and reports the error without calling the server", async () => {
    landOn("/#access_token=token-abc");

    render(<HashSessionBridge />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/?auth=error"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("reports the error when the server rejects the tokens", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    landOn("/#access_token=token-abc&refresh_token=refresh-abc");

    render(<HashSessionBridge />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/?auth=error"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("surfaces a provider error fragment as the auth error", async () => {
    landOn("/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired");

    render(<HashSessionBridge />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/?auth=error"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });
});
