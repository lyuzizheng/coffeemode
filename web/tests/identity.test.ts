import { describe, expect, it, vi } from "vitest";
import {
  canChangeHandle,
  generatePublicHandle,
  HANDLE_CHANGE_COOLDOWN_MS,
  PUBLIC_HANDLE_REGEX,
  slugifyDisplayName,
  validatePublicHandle,
} from "@/lib/db/identity";

describe("Identity - Handle Validation & Regex (Q11)", () => {
  it("matches valid public handles", () => {
    expect(validatePublicHandle("abc")).toBe(true);
    expect(validatePublicHandle("alex-doe")).toBe(true);
    expect(validatePublicHandle("coffee_lover_99")).toBe(true);
    expect(validatePublicHandle("user-1234")).toBe(true);
    expect(validatePublicHandle("a".repeat(30))).toBe(true);
    expect(PUBLIC_HANDLE_REGEX.test("nomad-3f9a")).toBe(true);
  });

  it("rejects handles shorter than 3 characters", () => {
    expect(validatePublicHandle("")).toBe(false);
    expect(validatePublicHandle("a")).toBe(false);
    expect(validatePublicHandle("ab")).toBe(false);
  });

  it("rejects handles longer than 30 characters", () => {
    expect(validatePublicHandle("a".repeat(31))).toBe(false);
  });

  it("rejects handles starting with hyphens or underscores", () => {
    expect(validatePublicHandle("-alex")).toBe(false);
    expect(validatePublicHandle("_alex")).toBe(false);
  });

  it("rejects uppercase characters, spaces, and invalid symbols", () => {
    expect(validatePublicHandle("Alex")).toBe(false);
    expect(validatePublicHandle("ALEX")).toBe(false);
    expect(validatePublicHandle("alex doe")).toBe(false);
    expect(validatePublicHandle("alex.doe")).toBe(false);
    expect(validatePublicHandle("alex@cafe")).toBe(false);
    expect(validatePublicHandle("alex!123")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(validatePublicHandle(null as unknown as string)).toBe(false);
    expect(validatePublicHandle(undefined as unknown as string)).toBe(false);
    expect(validatePublicHandle(123 as unknown as string)).toBe(false);
  });
});

describe("Identity - Display Name Slugification", () => {
  it("converts display names to clean lowercase base slugs", () => {
    expect(slugifyDisplayName("Alex Doe")).toBe("alex-doe");
    expect(slugifyDisplayName("Alice")).toBe("alice");
    expect(slugifyDisplayName("  Coffee Lover! ")).toBe("coffee-lover");
    expect(slugifyDisplayName("super--nomad")).toBe("super-nomad");
  });

  it("collapses non-ASCII or Chinese display names to 'nomad'", () => {
    expect(slugifyDisplayName("阿珍")).toBe("nomad");
    expect(slugifyDisplayName("☕️")).toBe("nomad");
    expect(slugifyDisplayName("!@#$%^")).toBe("nomad");
    expect(slugifyDisplayName("   ")).toBe("nomad");
  });

  it("strips emojis but retains valid alphanumeric segments", () => {
    expect(slugifyDisplayName("☕️ Nomad")).toBe("nomad");
    expect(slugifyDisplayName("Bob ☕️")).toBe("bob");
  });

  it("caps slug length at 25 characters to leave room for -xxxx suffix", () => {
    const longName = "abcdefghijklmnopqrstuvwxyz123456789";
    const slug = slugifyDisplayName(longName);
    expect(slug.length).toBeLessThanOrEqual(25);
    expect(slug).toBe("abcdefghijklmnopqrstuvwxy");
  });
});

describe("Identity - Handle Generation (Q2)", () => {
  it("generates a collision-safe handle with slug and 4-char suffix", async () => {
    const handle = await generatePublicHandle("Alex");
    expect(handle).toMatch(/^alex-[0-9a-f]{4}$/);
    expect(validatePublicHandle(handle)).toBe(true);
  });

  it("uses nomad fallback when display name has no ASCII characters", async () => {
    const handle = await generatePublicHandle("咖啡爱好者");
    expect(handle).toMatch(/^nomad-[0-9a-f]{4}$/);
    expect(validatePublicHandle(handle)).toBe(true);
  });

  it("retries on handle collision until a unique candidate is found", async () => {
    const attempts: string[] = [];
    const isTaken = vi.fn().mockImplementation(async (candidate: string) => {
      attempts.push(candidate);
      return attempts.length <= 2; // Collision on first two attempts
    });

    const handle = await generatePublicHandle("Nomad", isTaken);
    expect(attempts.length).toBe(3);
    expect(isTaken).toHaveBeenCalledTimes(3);
    expect(validatePublicHandle(handle)).toBe(true);
  });

  it("throws when max retry attempts (10) are exhausted", async () => {
    const alwaysTaken = vi.fn().mockResolvedValue(true);
    await expect(generatePublicHandle("Nomad", alwaysTaken)).rejects.toThrow(
      /Failed to generate unique public handle/,
    );
  });
});

describe("Identity - 7-Day Handle Change Cooldown (Q11)", () => {
  it("permits change when publicHandleChangedAt is null (auto-generated or new)", () => {
    expect(canChangeHandle(null)).toBe(true);
  });

  it("permits change when at least 7 days have elapsed", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(canChangeHandle(eightDaysAgo)).toBe(true);

    const exactlySevenDaysAgo = new Date(Date.now() - HANDLE_CHANGE_COOLDOWN_MS);
    expect(canChangeHandle(exactlySevenDaysAgo)).toBe(true);
  });

  it("rejects change when less than 7 days have elapsed", () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(canChangeHandle(oneDayAgo)).toBe(false);

    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    expect(canChangeHandle(sixDaysAgo)).toBe(false);

    const justNow = new Date(Date.now() - 1000);
    expect(canChangeHandle(justNow)).toBe(false);
  });
});
