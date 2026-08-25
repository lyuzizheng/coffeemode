import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/lib/security/origin";

describe("isSameOrigin validation", () => {
  it("rejects when Sec-Fetch-Site is cross-site", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        "sec-fetch-site": "cross-site",
        origin: "https://evil.com",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts when Sec-Fetch-Site is same-origin and Origin matches Host", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        "sec-fetch-site": "same-origin",
        origin: "https://coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("accepts matching x-forwarded-host behind proxy", () => {
    const req = new Request("https://localhost/api/checkins", {
      method: "POST",
      headers: {
        host: "internal-service",
        "x-forwarded-host": "coffeemode.app",
        origin: "https://coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects when Origin does not match Host or x-forwarded-host", () => {
    const req = new Request("https://coffeemode.app/api/cafes", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        origin: "https://malicious-site.com",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("rejects malformed Origin header", () => {
    const req = new Request("https://coffeemode.app/api/cafes", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        origin: "not-a-valid-url",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts when Origin is absent and no cross-site indicators exist", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects mismatched Referer when Origin is absent", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        referer: "https://attacker.org/phishing",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts matching Referer when Origin is absent", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        referer: "https://coffeemode.app/cafes/123",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });
});
