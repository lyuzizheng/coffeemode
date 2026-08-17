import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("NotFound", () => {
  it("renders the designed 404 with a link home", () => {
    render(<NotFound />, { wrapper: Wrapper });
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
