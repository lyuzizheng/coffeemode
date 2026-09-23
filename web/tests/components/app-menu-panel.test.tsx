import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuPanel } from "@/components/layout/app-menu-panel";
import type { MapTranslator } from "@/components/layout/app-menu-types";
import en from "@/messages/en.json";

function mockTranslator(key: string): string {
  const mapMessages = en.map as Record<string, string>;
  return mapMessages[key] ?? key;
}

describe("MenuPanel (BRAWUKA-585)", () => {
  const baseProps = {
    activeTheme: "light" as const,
    nextTheme: "dark" as const,
    nextLocale: "zh",
    reduced: true,
    onTheme: vi.fn(),
    onLocale: vi.fn(),
    t: mockTranslator as unknown as MapTranslator,
  };

  it("renders role='menu' with role='menuitem' children for a complete a11y tree", () => {
    render(<MenuPanel {...baseProps} />);

    const menu = screen.getByRole("menu", { name: "Menu" });
    expect(menu).toBeInTheDocument();

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems).toHaveLength(4);

    // Each row has role="menuitem"
    expect(screen.getByRole("menuitem", { name: /Theme/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Language/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Sign in/i })).toBeInTheDocument();
  });

  it("renders profile aria label when accountInitial is provided", () => {
    render(<MenuPanel {...baseProps} accountInitial="J" />);

    const profileItem = screen.getByRole("menuitem", { name: /Profile/i });
    expect(profileItem).toBeInTheDocument();
    expect(profileItem).toHaveAttribute("href", "/profile");
  });

  it("triggers onTheme callback when theme menuitem is clicked", () => {
    const onTheme = vi.fn();
    render(<MenuPanel {...baseProps} onTheme={onTheme} />);

    fireEvent.click(screen.getByRole("menuitem", { name: /Theme/i }));
    expect(onTheme).toHaveBeenCalledWith("dark");
  });

  it("triggers onLocale callback when language menuitem is clicked", () => {
    const onLocale = vi.fn();
    render(<MenuPanel {...baseProps} onLocale={onLocale} />);

    fireEvent.click(screen.getByRole("menuitem", { name: /Language/i }));
    expect(onLocale).toHaveBeenCalled();
  });
});
