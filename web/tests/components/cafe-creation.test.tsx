import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PolicyChips, policyOptions } from "@/components/cafe/policy-chips";
import { POIPreview } from "@/components/cafe/poi-preview";
import { CafeCreationSheet, CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";
import { uploadPhoto } from "@/lib/images/client-upload";
import messages from "../../messages/en.json";
import type { POI } from "@shared/places/types";

vi.mock("@/lib/images/client-upload", () => ({ uploadPhoto: vi.fn() }));

// MapKit loads from Apple's CDN in a real browser; the stub is the service
// boundary that hands a selected Apple place back to the sheet.
const APPLE_PLACE = vi.hoisted<POI>(() => ({
  place_id: "apple-1",
  source: "apple",
  name: "Apple Cafe",
  lat: 1.3,
  lng: 103.8,
  address: "Sample Address",
  types: ["cafe"],
  business_status: null,
  hours_json: null,
  photo_refs: [],
  fetched_at: "2026-01-01T00:00:00.000Z",
}));

vi.mock("@/components/cafe/apple-place-search", () => ({
  ApplePlaceSearch: ({ onSelect }: { onSelect: (poi: POI) => void }) => (
    <button type="button" onClick={() => onSelect(APPLE_PLACE)}>
      Pick an Apple place
    </button>
  ),
}));

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

describe("CafeCreationSheet & Trigger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders trigger button and opens sheet when clicked", () => {
    render(<CafeCreationTrigger isAuthenticated={true} />, { wrapper: Wrapper });

    const trigger = screen.getByRole("button", { name: /Add a cafe/i });
    expect(trigger).toBeEnabled();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces server error message when external place persist fails", async () => {
    const onOpenChange = vi.fn();

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/places/resolve")) {
        return {
          ok: true,
          json: async () => ({
            place_id: "apple-1",
            source: "apple",
            name: "Apple Cafe",
            lat: 1.3,
            lng: 103.8,
            address: "Sample Address",
            types: ["cafe"],
            business_status: null,
            hours_json: null,
            photo_refs: [],
            fetched_at: new Date().toISOString(),
          }),
        };
      }
      if (url.includes("/api/places/external")) {
        return {
          ok: false,
          json: async () => ({ error: "External place persist rejected" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <CafeCreationSheet isOpen={true} onOpenChange={onOpenChange} isAuthenticated={true} />,
      { wrapper: Wrapper },
    );

    const input = screen.getByPlaceholderText(/maps\.apple\.com/i);
    fireEvent.change(input, { target: { value: "https://maps.apple.com/place?id=1" } });

    const resolveBtn = screen.getByRole("button", { name: /Resolve link/i });
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

describe("CafeCreationSheet session expiry (BRAWUKA-124/BRAWUKA-212)", () => {
  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  /** Resolve-link succeeds; every other route defers to the test's handler. */
  function mockRoutes(handler: (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes("/api/places/resolve")) return jsonResponse(200, APPLE_PLACE);
      return handler(target);
    });
  }

  async function openSheetWithPoi() {
    render(<CafeCreationSheet isOpen onOpenChange={vi.fn()} isAuthenticated />, { wrapper: Wrapper });
    fireEvent.change(screen.getByPlaceholderText(/maps\.apple\.com/i), {
      target: { value: "https://maps.apple.com/place?id=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Resolve link/i }));
    await screen.findByRole("button", { name: "Create cafe" });
  }

  function fileInput(): HTMLInputElement {
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error("photo input not rendered");
    return input as HTMLInputElement;
  }

  function fillAndSubmit() {
    fireEvent.change(screen.getByRole("slider", { name: "Overall work score" }), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByPlaceholderText("How was the wifi, seats, and vibe?"), {
      target: { value: "great wifi" },
    });
    fireEvent.change(fileInput(), {
      target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create cafe" }));
  }

  async function expectSignInGate() {
    await waitFor(() => {
      expect(screen.getByText(/Please sign in to publish/)).toBeInTheDocument();
    });
    // A dead session is not a form error, and no raw code may surface here.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("unauthorized")).not.toBeInTheDocument();
  }

  beforeEach(() => {
    vi.mocked(uploadPhoto).mockReset();
  });

  it("routes the create POST's 401 to the drawer's sign-in gate", async () => {
    vi.mocked(uploadPhoto).mockResolvedValue("img-uuid-1");
    mockRoutes((url) => (url.includes("/api/cafes") ? jsonResponse(401, { error: "unauthorized" }) : jsonResponse(200, {})));

    await openSheetWithPoi();
    fillAndSubmit();

    await expectSignInGate();
  });

  it("routes a publish-time photo upload 401 to the gate without posting", async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("unauthorized"));
    mockRoutes(() => jsonResponse(200, {}));

    await openSheetWithPoi();
    fillAndSubmit();

    await expectSignInGate();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/cafes",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("routes a Google place-search 401 to the gate instead of the alert slot", async () => {
    mockRoutes((url) => (url.includes("/api/places/search") ? jsonResponse(401, { error: "unauthorized" }) : jsonResponse(200, {})));

    render(<CafeCreationSheet isOpen onOpenChange={vi.fn()} isAuthenticated />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("tab", { name: "Search a place" }));
    fireEvent.change(screen.getByPlaceholderText("Search for a cafe"), {
      target: { value: "blue bottle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await expectSignInGate();
  });

  it("routes an Apple place-persist 401 to the gate", async () => {
    mockRoutes((url) => (url.includes("/api/places/external") ? jsonResponse(401, { error: "unauthorized" }) : jsonResponse(200, {})));

    render(<CafeCreationSheet isOpen onOpenChange={vi.fn()} isAuthenticated />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("tab", { name: "Search a place" }));
    fireEvent.click(screen.getByRole("button", { name: "Apple Maps" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick an Apple place" }));

    await expectSignInGate();
  });

  it("shows generic copy for an unmapped server code and logs the code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(uploadPhoto).mockResolvedValue("img-uuid-1");
    mockRoutes((url) => (url.includes("/api/cafes") ? jsonResponse(500, { error: "internal_error" }) : jsonResponse(200, {})));

    await openSheetWithPoi();
    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("The cafe could not be created.");
    });
    expect(screen.queryByText("internal_error")).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "internal_error" }),
    );
  });

  it("shows generic copy for an unmapped client upload marker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(uploadPhoto).mockRejectedValue(new Error("image_processing_error"));
    mockRoutes(() => jsonResponse(200, {}));

    await openSheetWithPoi();
    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("The cafe could not be created.");
    });
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "image_processing_error" }),
    );
  });
});
