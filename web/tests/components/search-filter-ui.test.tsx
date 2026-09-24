import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SearchFilterControls } from "@/components/search/search-filter-ui";
import type { SearchFilterState } from "@/lib/search/search-filters";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function renderControls(filters: SearchFilterState, onFiltersChange = vi.fn()) {
  render(
    <Wrapper>
      <SearchFilterControls
        filters={filters}
        resultCount={null}
        onFiltersChange={onFiltersChange}
        onReset={vi.fn()}
      />
    </Wrapper>,
  );
  return onFiltersChange;
}

const base: SearchFilterState = { openNow: false, thresholds: {}, maxStay: null };

function wifiRadios() {
  const group = screen.getByRole("radiogroup", { name: "Wifi" });
  return { group, radios: within(group).getAllByRole("radio") };
}

describe("DimSegmentRow custom scores (BRAWUKA-678)", () => {
  it("keeps a checked, tabbable radio when the URL carries a non-60/80 score", () => {
    renderControls({ ...base, thresholds: { wifi: 63 } });
    const { radios } = wifiRadios();

    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("63+");
    expect(checked[0]).toHaveAttribute("tabindex", "0");
    for (const r of radios.filter((r) => r !== checked[0])) {
      expect(r).toHaveAttribute("tabindex", "-1");
    }
  });

  it("orders the custom option between the tri-state thresholds", () => {
    renderControls({ ...base, thresholds: { wifi: 63 } });
    const { radios } = wifiRadios();
    expect(radios.map((r) => r.textContent)).toEqual(["Any", "60+", "63+", "80+"]);
  });

  it("lets arrow keys move off a custom score onto a standard threshold", () => {
    const onFiltersChange = renderControls({ ...base, thresholds: { wifi: 63 } });
    const { group, radios } = wifiRadios();

    const custom = radios.find((r) => r.textContent === "63+")!;
    custom.focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...base,
      thresholds: { wifi: 80 },
    });
    expect(document.activeElement).toBe(radios.find((r) => r.textContent === "80+"));
  });

  it("still checks the matching tri-state option for standard scores", () => {
    renderControls({ ...base, thresholds: { wifi: 60 } });
    const { radios } = wifiRadios();

    expect(radios.map((r) => r.textContent)).toEqual(["Any", "60+", "80+"]);
    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("60+");
    expect(checked[0]).toHaveAttribute("tabindex", "0");
  });
});
