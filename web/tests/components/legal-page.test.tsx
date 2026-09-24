import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LegalPage } from "@/components/legal/legal-page";

/**
 * BRAWUKA-554: `legal.about.updated` is "Version {version}" / "版本 {version}"
 * but the header rendered it verbatim — `t("updated")` never received the
 * `values` prop that `app/about/page.tsx` already supplies. These tests drive
 * the real en/zh catalogs through a real translator so the placeholder must
 * actually interpolate, not just be asserted away.
 */

const state = vi.hoisted(() => ({ locale: "en" as "en" | "zh" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { namespace?: string }) => {
    const [{ createTranslator }, en, zh] = await Promise.all([
      import("next-intl"),
      import("../../messages/en.json"),
      import("../../messages/zh.json"),
    ]);
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    return createTranslator({
      locale: state.locale,
      messages: (state.locale === "zh" ? zh : en).default,
      namespace: namespace as never,
    });
  },
}));

describe("LegalPage (BRAWUKA-554)", () => {
  it("interpolates {version} in the about header stamp (en)", async () => {
    state.locale = "en";
    render(
      await LegalPage({
        page: "about",
        sections: ["mission"],
        values: { version: "1.2.3" },
      }),
    );
    expect(screen.getByText("Version 1.2.3")).toBeTruthy();
    expect(screen.queryByText(/\{version\}/)).toBeNull();
  });

  it("interpolates {version} in the about header stamp (zh)", async () => {
    state.locale = "zh";
    render(
      await LegalPage({
        page: "about",
        sections: ["mission"],
        values: { version: "1.2.3" },
      }),
    );
    expect(screen.getByText("版本 1.2.3")).toBeTruthy();
    expect(screen.queryByText(/\{version\}/)).toBeNull();
  });

  it("renders the static updated stamp when no values are given (privacy)", async () => {
    state.locale = "en";
    render(
      await LegalPage({ page: "privacy", sections: ["collect"] }),
    );
    expect(screen.getByText("Last updated: September 2026")).toBeTruthy();
  });
});
