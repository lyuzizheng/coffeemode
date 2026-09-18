import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CafePlaceSearch } from "@/components/cafe/cafe-place-search";
import messages from "../../messages/zh.json";

/**
 * BRAWUKA-463: a provider init rejection carries an English diagnostic
 * (script load timeout, token route 503). The shared alert slot must show
 * the localized unavailable copy — the raw `Error.message` is diagnostics,
 * not user-facing text.
 */
vi.mock("@/lib/places/providers", () => ({
  getPlaceSearchProviders: () => [
    {
      id: "apple",
      label: "Apple Maps",
      persistOnSelect: true,
      init: () => Promise.reject(new Error("MapKit script load timed out")),
      search: async () => [],
    },
  ],
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="zh" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("CafePlaceSearch provider init failure (BRAWUKA-463)", () => {
  it("surfaces the localized unavailable copy, not the raw Error.message", async () => {
    const onError = vi.fn();
    render(
      <CafePlaceSearch
        onSelectPOI={vi.fn()}
        onError={onError}
        onRequireSignIn={vi.fn()}
        mapkitConfigured={true}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith("暂时无法搜索。"));
    expect(onError).not.toHaveBeenCalledWith("MapKit script load timed out");
  });
});
