import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ErrorPage from "@/app/error";
import { GenericNotFound } from "@/components/errors/generic-not-found";
import { GoneCafeNotFound } from "@/components/errors/gone-cafe-not-found";
import messages from "../../messages/en.json";

// Recovery block reads route params only when no id prop is passed; keep the
// hook resolvable outside the App Router.
vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ refresh: vi.fn() }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("GenericNotFound", () => {
  it("renders the designed 404 with a link home", () => {
    render(<GenericNotFound />, { wrapper: Wrapper });
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "This page isn't here" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("GoneCafeNotFound (DG19/DG111)", () => {
  const GONE = "550e8400-e29b-41d4-a716-446655440099";

  it("renders the quiet gone-cafe surface with Back to discover", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"cafes":[]}', { status: 200 })));
    render(<GoneCafeNotFound cafeId={GONE} />, { wrapper: Wrapper });
    expect(
      screen.getByRole("heading", { name: "This cafe is gone" }),
    ).toBeInTheDocument();
    expect(screen.getByText("It may have been removed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to discover" })).toHaveAttribute(
      "href",
      "/",
    );
    vi.unstubAllGlobals();
  });

  it("lists recovery cafes from the gone cafe's last known location", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        cafes: [
          { id: "550e8400-e29b-41d4-a716-446655440101", name: "Neighbor", distance_m: 320 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<GoneCafeNotFound cafeId={GONE} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Neighbor/ })).toHaveAttribute(
        "href",
        "/cafes/550e8400-e29b-41d4-a716-446655440101",
      );
    });
    expect(screen.getByText("More cafes nearby")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/cafes/${GONE}/recovery`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    vi.unstubAllGlobals();
  });

  it("skips the recovery fetch for a malformed id", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GoneCafeNotFound cafeId="not-a-uuid" />, { wrapper: Wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("ErrorPage", () => {
  it("renders the designed error with retry and home actions", () => {
    render(<ErrorPage error={new Error("boom")} retry={() => {}} />, {
      wrapper: Wrapper,
    });
    expect(
      screen.getByRole("heading", { name: "Something broke" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("calls retry() when retry is pressed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<ErrorPage error={new Error("boom")} retry={retry} />, {
      wrapper: Wrapper,
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("logs the underlying error to the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    render(<ErrorPage error={error} retry={() => {}} />, { wrapper: Wrapper });
    expect(spy).toHaveBeenCalledWith(error);
    spy.mockRestore();
  });
});
