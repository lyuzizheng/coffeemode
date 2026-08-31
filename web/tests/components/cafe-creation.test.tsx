import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PolicyChips, policyOptions } from "@/components/cafe/policy-chips";
import { POIPreview } from "@/components/cafe/poi-preview";
import { CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";
import messages from "../../messages/en.json";
import type { POI } from "@shared/places/types";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("PolicyChips", () => {
  it("renders options and calls onSelect on click", () => {
    const options = [
      { value: "short", label: "< 1 hour" },
      { value: "medium", label: "1-2 hours" },
    ];
    const onSelect = vi.fn();

    render(
      <PolicyChips
        label="Max Stay"
        options={options}
        selected="short"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Max Stay")).toBeInTheDocument();
    const shortBtn = screen.getByRole("button", { name: "< 1 hour" });
    const mediumBtn = screen.getByRole("button", { name: "1-2 hours" });

    expect(shortBtn).toHaveAttribute("aria-pressed", "true");
    expect(mediumBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(mediumBtn);
    expect(onSelect).toHaveBeenCalledWith("medium");
  });

  it("policyOptions helper maps keys to labels", () => {
    const mapped = policyOptions(["a", "b"], { a: "Label A" });
    expect(mapped).toEqual([
      { value: "a", label: "Label A" },
      { value: "b", label: "b" },
    ]);
  });
});

describe("POIPreview", () => {
  it("renders POI details and allows editing the name", () => {
    const poi: POI = {
      place_id: "p-123",
      source: "google",
      name: "Blue Bottle Coffee",
      lat: 1.3521,
      lng: 103.8198,
      address: "123 Orchard Rd",
      types: ["cafe"],
      business_status: "OPERATIONAL",
      hours_json: null,
      photo_refs: [],
      fetched_at: new Date().toISOString(),
    };

    const onNameChange = vi.fn();

    render(
      <POIPreview poi={poi} name="Blue Bottle Coffee" onNameChange={onNameChange} />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("123 Orchard Rd")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Blue Bottle Coffee")).toBeInTheDocument();

    const input = screen.getByDisplayValue("Blue Bottle Coffee");
    fireEvent.change(input, { target: { value: "Blue Bottle Tokyo" } });
    expect(onNameChange).toHaveBeenCalledWith("Blue Bottle Tokyo");
  });
});

describe("CafeCreationTrigger", () => {
  it("renders trigger button and opens sheet when clicked", () => {
    render(<CafeCreationTrigger isAuthenticated={true} />, { wrapper: Wrapper });

    const trigger = screen.getByRole("button", { name: /Add a cafe/i });
    expect(trigger).toBeEnabled();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
