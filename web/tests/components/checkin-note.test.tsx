import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CheckinNote, CHECKIN_NOTE_COLLAPSE_AT } from "@/components/checkin/checkin-note";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";

function renderNote(note: string, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
      <CheckinNote note={note} />
    </NextIntlClientProvider>,
  );
}

describe("CheckinNote prose card", () => {
  it("renders short notes as serif editorial prose with no toggle", () => {
    const { container } = renderNote("Corner seat, fast wifi.");
    const prose = screen.getByText("Corner seat, fast wifi.");
    expect(prose.tagName).toBe("P");
    expect(prose.className).toContain("font-serif");
    expect(prose.className).toContain("text-prose");
    expect(container.querySelector(".max-w-\\[68ch\\]")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("renders nothing for empty or whitespace-only notes", () => {
    const { container: empty } = renderNote("");
    expect(empty).toBeEmptyDOMElement();
    const { container: blank } = renderNote("   ");
    expect(blank).toBeEmptyDOMElement();
  });

  it("collapses long notes behind a plain expandable disclosure", () => {
    const long = `${"word ".repeat(60).trim()} end.`;
    expect(long.length).toBeGreaterThan(CHECKIN_NOTE_COLLAPSE_AT);
    renderNote(long);

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.getAttribute("aria-controls")).not.toBeNull();
    // Collapsed: truncated with ellipsis, full tail hidden.
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    expect(screen.queryByText("end.", { exact: false })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(long)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("renders the zh toggle labels with the serif stack intact", () => {
    renderNote(`${"词 ".repeat(150).trim()} 尾。`, "zh");
    expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument();
    expect(screen.getByText(/…$/).className).toContain("font-serif");
  });
});
