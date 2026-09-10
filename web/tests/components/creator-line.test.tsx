import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CreatorLine } from "@/components/discovery/creator-line";
import enMessages from "../../messages/en.json";
import zhMessages from "../../messages/zh.json";

function renderLine(
  props: { author: { handle: string; display_name: string; avatar_url: string | null } | null; maintainer: string | null },
  locale: "en" | "zh" = "en",
) {
  const messages = locale === "en" ? enMessages : zhMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CreatorLine {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CreatorLine", () => {
  it("renders the named author with avatar when opted in", () => {
    const { container } = renderLine({
      author: { handle: "alice-1a2b", display_name: "Alice", avatar_url: "https://img.example/a.webp" },
      maintainer: null,
    });

    expect(screen.getByText("By Alice")).toBeInTheDocument();
    const img = container.querySelector("img");
    expect(decodeURIComponent(img?.getAttribute("src") ?? "")).toContain("https://img.example/a.webp");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("renders the named author without avatar when none is set", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreatorLine
          author={{ handle: "alice-1a2b", display_name: "Alice", avatar_url: null }}
          maintainer={null}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("By Alice")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the anonymous copy when no author consented", () => {
    renderLine({ author: null, maintainer: null });

    expect(screen.getByText("A nomad")).toBeInTheDocument();
  });

  it("renders the service-account maintainer label untouched", () => {
    renderLine({ author: null, maintainer: "由 CoffeeMode 维护" });

    expect(screen.getByText("由 CoffeeMode 维护")).toBeInTheDocument();
    expect(screen.queryByText("A nomad")).toBeNull();
  });

  it("prefers the consented author over the maintainer label", () => {
    renderLine({
      author: { handle: "alice-1a2b", display_name: "Alice", avatar_url: null },
      maintainer: "由 CoffeeMode 维护",
    });

    expect(screen.getByText("By Alice")).toBeInTheDocument();
    expect(screen.queryByText("由 CoffeeMode 维护")).toBeNull();
  });

  it("keeps zh anonymous and named copy in parity", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <CreatorLine author={null} maintainer={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("一位 nomad")).toBeInTheDocument();
    unmount();

    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <CreatorLine
          author={{ handle: "alice-1a2b", display_name: "Alice", avatar_url: null }}
          maintainer={null}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
