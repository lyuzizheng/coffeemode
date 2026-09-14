import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as checkinPOST } from "@/app/api/checkins/route";
import { POST as cafesPOST } from "@/app/api/cafes/route";
import { GET as lastGET } from "@/app/api/checkins/last/route";
import { POST as likePOST } from "@/app/api/checkins/[id]/like/route";
import { GET as feedGET } from "@/app/api/cafes/[id]/checkins/route";
import { GET as profileCheckinsGET } from "@/app/api/profile/checkins/route";
import { GET as profileCafesGET } from "@/app/api/profile/cafes/route";
import type { CheckInFeedPage } from "@/types/checkins";
import type { ToggleLikeResult } from "@/lib/db/checkins/likes";

const getUserMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));

/**
 * Wire-casing contract (BRAWUKA-280): every JSON key the API emits over the
 * wire is lower_snake_case. camelCase outliers (`checkinId`, `cafeId`,
 * `likesCount`, `revisitWindowHours`, `nextCursor`) silently produce
 * `undefined` in new consumers, so this suite fails on any regression.
 */
function collectKeys(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
}

function expectSnakeKeys(body: unknown, where: string) {
  const found: string[] = [];
  collectKeys(body, found);
  const bad = found.filter((k) => /[A-Z]/.test(k));
  expect(bad, `${where} emitted camelCase keys: ${bad.join(", ")}`).toEqual([]);
}

describe("wire casing contract", () => {
  it("emits snake_case keys on the touched error envelopes", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const bodies: Array<[unknown, string]> = [
      [
        await (
          await checkinPOST(
            new Request("https://localhost/api/checkins", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            }),
          )
        ).json(),
        "POST /api/checkins 400",
      ],
      [
        await (
          await cafesPOST(
            new Request("https://localhost/api/cafes", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            }),
          )
        ).json(),
        "POST /api/cafes 400",
      ],
      [
        await (await lastGET(new NextRequest("https://localhost/api/checkins/last?cafe_id=not-a-uuid"))).json(),
        "GET /api/checkins/last 400",
      ],
      [
        await (
          await likePOST(new Request("https://localhost/api/checkins/nope/like", { method: "POST" }), {
            params: Promise.resolve({ id: "nope" }),
          })
        ).json(),
        "POST /api/checkins/[id]/like 400",
      ],
      [
        await (
          await feedGET(new Request("https://localhost/api/cafes/nope/checkins?mode=newest"), {
            params: Promise.resolve({ id: "nope" }),
          })
        ).json(),
        "GET /api/cafes/[id]/checkins 400",
      ],
      [
        await (await profileCheckinsGET(new NextRequest("https://localhost/api/profile/checkins"))).json(),
        "GET /api/profile/checkins 401",
      ],
      [
        await (await profileCafesGET(new NextRequest("https://localhost/api/profile/cafes"))).json(),
        "GET /api/profile/cafes 401",
      ],
    ];
    for (const [body, where] of bodies) expectSnakeKeys(body, where);
  });

  it("pins the converged success-shape keys", () => {
    const feed: CheckInFeedPage = { checkins: [], next_cursor: null };
    expectSnakeKeys(feed, "CheckInFeedPage");

    const like: ToggleLikeResult = { liked: true, likes_count: 0 };
    expectSnakeKeys(like, "ToggleLikeResult");

    expectSnakeKeys(
      { checkin: null, revisit_window_hours: 24 },
      "GET /api/checkins/last 200",
    );
    expectSnakeKeys({ cafe_id: "c", checkin_id: "h" }, "POST /api/cafes 201");
    expectSnakeKeys({ checkin_id: "h" }, "POST /api/checkins 201");
  });
});
