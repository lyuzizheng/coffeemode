import { describe, expect, it, vi } from "vitest";
import { profileFromUser, upsertProfile } from "@/lib/auth/profiles";

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

  it("picks avatar_url over picture", () => {
    expect(
      profileFromUser({
        id: "u1",
        user_metadata: { avatar_url: "a.png", picture: "p.png" },
      }).avatarUrl,
    ).toBe("a.png");
    expect(
      profileFromUser({ id: "u1", user_metadata: { picture: "p.png" } })
        .avatarUrl,
    ).toBe("p.png");
    expect(profileFromUser({ id: "u1" }).avatarUrl).toBeNull();
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
});
