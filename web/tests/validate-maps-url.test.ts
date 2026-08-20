import { describe, expect, it } from "vitest";
import { isValidMapsUrl } from "@/lib/places/validate-maps-url";

describe("isValidMapsUrl", () => {
  it("accepts canonical google maps links", () => {
    for (const u of [
      "https://www.google.com/maps/place/Blue+Bottle/@37.7,-122.4,17z/data=!4m6!3m5!1s0x8085:0x9f2c",
      "https://google.com/maps?q=coffee",
      "https://maps.google.com/?q=1.35,103.82",
    ]) {
      expect(isValidMapsUrl(u)).toBe(true);
    }
  });

  it("accepts regional google domains (issue #37)", () => {
    for (const u of [
      "https://www.google.co.uk/maps/place/x",
      "https://maps.google.de/maps?q=coffee",
      "https://google.com.sg/maps/place/x",
      "https://www.google.com.au/maps/search/coffee",
    ]) {
      expect(isValidMapsUrl(u)).toBe(true);
    }
  });

  it("accepts google short links and apple maps", () => {
    expect(isValidMapsUrl("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isValidMapsUrl("https://goo.gl/maps/abc")).toBe(true);
    expect(isValidMapsUrl("https://maps.apple/place?place-id=I123")).toBe(true);
    expect(isValidMapsUrl("https://maps.apple.com/?q=coffee&ll=1.3,103.8")).toBe(true);
  });

  it("rejects non-map google subdomains", () => {
    for (const u of [
      "https://drive.google.com/file/d/x",
      "https://mail.google.com/mail/x",
      "https://photos.google.com/x",
    ]) {
      expect(isValidMapsUrl(u)).toBe(false);
    }
  });

  it("rejects lookalike and unrelated hosts", () => {
    for (const u of [
      "https://google.com.evil.com/maps",
      "https://maps.apple.com.evil.com/?q=x",
      "https://evilgoogle.com/maps",
      "https://example.com/maps",
      // attacker-registrable TLD shapes
      "https://google.evil.io/maps",
      "https://google.attacker.co/maps",
      "https://google.zip/maps",
      // userinfo trick: real host is evil.com
      "https://www.google.com@evil.com/maps",
    ]) {
      expect(isValidMapsUrl(u)).toBe(false);
    }
  });

  it("requires https", () => {
    expect(isValidMapsUrl("http://www.google.com/maps/place/x")).toBe(false);
    expect(isValidMapsUrl("http://maps.app.goo.gl/abc")).toBe(false);
  });

  it("rejects non-URLs and non-http(s) schemes", () => {
    expect(isValidMapsUrl("not-a-url")).toBe(false);
    expect(isValidMapsUrl("ftp://www.google.com/maps")).toBe(false);
    expect(isValidMapsUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects bare apple.com — share links are maps.apple.com", () => {
    expect(isValidMapsUrl("https://apple.com")).toBe(false);
    expect(isValidMapsUrl("https://www.apple.com/maps")).toBe(false);
  });
});
