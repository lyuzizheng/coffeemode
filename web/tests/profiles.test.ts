import { describe, expect, it, vi } from "vitest";
import {
  profileFromUser,
  sanitizeAvatarUrl,
  upsertProfile,
} from "@/lib/auth/profiles";
import { appConfig } from "@/lib/config";

describe("profileFromUser", () => {
  it("prefers full_name, then falls back through the metadata chain", () => {
    expect(
      profileFromUser({
        id: "u1",
        user_metadata: { full_name: "Ada Lovelace", name: "ignored" },
      }).displayName,
    ).toBe("Ada Lovelace");

    expect(
      profileFromUser({ id: "u1", user_metadata: { name: "Grace" } })
        .displayName,
    ).toBe("Grace");

    expect(
      profileFromUser({ id: "u1", user_metadata: { user_name: "nomad_kim" } })
        .displayName,
    ).toBe("nomad_kim");
  });

  it("falls back to the email local part, then a default", () => {
    expect(profileFromUser({ id: "u1", email: "kim@cafe.sg" }).displayName).toBe(
      "kim",
    );
    expect(profileFromUser({ id: "u1" }).displayName).toBe("A nomad");
  });

  it("truncates an overlong provider display name to the product cap", () => {
    const max = appConfig.profile.displayNameMaxChars;
    const long = "x".repeat(max + 50);
    expect(
      profileFromUser({ id: "u1", user_metadata: { full_name: long } })
        .displayName,
    ).toBe("x".repeat(max));
  });

  it("skips blank and non-string provider names", () => {
    expect(
      profileFromUser({
        id: "u1",
        user_metadata: { full_name: "   ", name: "Grace" },
      }).displayName,
    ).toBe("Grace");
    expect(
      profileFromUser({
        id: "u1",
        user_metadata: { full_name: 42 as unknown as string },
        email: "kim@cafe.sg",
      }).displayName,
    ).toBe("kim");
  });

  it("picks avatar_url over picture when the host is allowlisted", () => {
    const google = "https://lh3.googleusercontent.com/a/avatar";
    const supabase = "https://xyz.supabase.co/storage/v1/object/avatar.png";
    expect(
      profileFromUser({
        id: "u1",
        user_metadata: { avatar_url: google, picture: supabase },
      }).avatarUrl,
    ).toBe(google);
    expect(
      profileFromUser({ id: "u1", user_metadata: { picture: supabase } })
        .avatarUrl,
    ).toBe(supabase);
    expect(profileFromUser({ id: "u1" }).avatarUrl).toBeNull();
  });

  it("rejects a non-allowlisted avatar URL to null", () => {
    expect(
      profileFromUser({
        id: "u1",
        user_metadata: { avatar_url: "https://evil.example/a.png" },
      }).avatarUrl,
    ).toBeNull();
  });
});

describe("sanitizeAvatarUrl", () => {
  it("accepts Google user-content and Supabase storage subdomains", () => {
    expect(
      sanitizeAvatarUrl("https://lh3.googleusercontent.com/a/avatar"),
    ).toBe("https://lh3.googleusercontent.com/a/avatar");
    expect(
      sanitizeAvatarUrl(
        "https://xyzcompany.supabase.co/storage/v1/object/a.png",
      ),
    ).toBe("https://xyzcompany.supabase.co/storage/v1/object/a.png");
  });

  it("rejects suffix lookalikes, non-https, relative, and overlong URLs", () => {
    expect(
      sanitizeAvatarUrl("https://googleusercontent.com.evil.com/a.png"),
    ).toBeNull();
    expect(sanitizeAvatarUrl("http://lh3.googleusercontent.com/a")).toBeNull();
    expect(sanitizeAvatarUrl("a.png")).toBeNull();
    expect(sanitizeAvatarUrl("")).toBeNull();
    expect(sanitizeAvatarUrl(null)).toBeNull();
    expect(
      sanitizeAvatarUrl(
        `https://lh3.googleusercontent.com/${"x".repeat(2048)}`,
      ),
    ).toBeNull();
  });
});

describe("upsertProfile", () => {
  it("inserts on first login and reports inserted=true", async () => {
    const run = vi.fn().mockResolvedValue({
      rows: [{ id: "u1", inserted: true }],
    });

    const result = await upsertProfile(
      { id: "u1", email: "kim@cafe.sg", user_metadata: { full_name: "Kim" } },
      run,
    );

    expect(result).toEqual({ id: "u1", inserted: true });
    expect(run).toHaveBeenCalledTimes(1);
    const [sql, params] = run.mock.calls[0];
    expect(sql).toContain("on conflict (id) do update set last_seen_at");
    expect(params).toEqual(["u1", "Kim", null]);
  });

  it("only touches last_seen_at on repeat sign-in", async () => {
    const run = vi.fn().mockResolvedValue({
      rows: [{ id: "u1", inserted: false }],
    });

    const result = await upsertProfile(
      { id: "u1", user_metadata: { full_name: "Kim Renamed Themselves" } },
      run,
    );

    // The conflict branch must not overwrite display_name — the user's
    // in-app rename wins over provider metadata on re-login.
    expect(result.inserted).toBe(false);
    expect(run.mock.calls[0][0]).not.toContain(
      "do update set display_name",
    );
  });

  it("stores the sanitized provider fields, not the raw metadata", async () => {
    const run = vi.fn().mockResolvedValue({
      rows: [{ id: "u1", inserted: true }],
    });

    await upsertProfile(
      {
        id: "u1",
        user_metadata: {
          full_name: "y".repeat(100),
          avatar_url: "https://evil.example/a.png",
        },
      },
      run,
    );

    const [, params] = run.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      "u1",
      "y".repeat(appConfig.profile.displayNameMaxChars),
      null,
    ]);
  });
});
