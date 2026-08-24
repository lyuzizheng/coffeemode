import { describe, expect, it } from "vitest";
import { buildShareData, isWeChatUserAgent } from "@/lib/share";

describe("isWeChatUserAgent (DG109)", () => {
  it("detects WeChat's in-app browser", () => {
    expect(
      isWeChatUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.44",
      ),
    ).toBe(true);
    expect(isWeChatUserAgent("Mozilla/5.0 micromessenger/8.0")).toBe(true);
  });

  it("rejects ordinary browsers and missing UAs", () => {
    expect(
      isWeChatUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(isWeChatUserAgent(null)).toBe(false);
    expect(isWeChatUserAgent(undefined)).toBe(false);
  });
});

describe("buildShareData", () => {
  it("packages title and url for the native share sheet", () => {
    expect(buildShareData("https://coffeemode.app/cafes/x", "Caracara")).toEqual({
      title: "Caracara",
      url: "https://coffeemode.app/cafes/x",
    });
  });
});
