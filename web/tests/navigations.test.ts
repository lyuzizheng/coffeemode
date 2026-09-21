import { beforeEach, describe, expect, it, vi } from "vitest";
import { CafeNotFoundError } from "@/lib/validation/checkin";
import {
  autoResolveNavigationsTx,
  navigationPromptQueue,
  parseNavigationBody,
  parsePromptAnswerBody,
  recordNavigation,
} from "@/lib/db/navigations";
import { POST as navPOST } from "@/app/api/navigations/route";
import { GET as promptGET } from "@/app/api/navigations/prompt/route";
import { POST as resolvePOST } from "@/app/api/navigations/[id]/resolve/route";

const getUserMock = vi.fn();
const clientQueryMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));

vi.mock("@/lib/db/postgres", () => ({
  withTransaction: (fn: (client: { query: typeof clientQueryMock }) => unknown) =>
    fn({ query: clientQueryMock }),
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

const USER = { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const NAV_ROW = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
  resolved: false,
  created_at: "2026-08-17T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  getUserMock.mockResolvedValue({ data: { user: USER }, error: null });
});

describe("parseNavigationBody", () => {
  it("accepts a valid cafe_id and rejects everything else", () => {
    expect(parseNavigationBody({ cafe_id: CAFE }).ok).toBe(true);
    expect(parseNavigationBody(null).ok).toBe(false);
    expect(parseNavigationBody({}).ok).toBe(false);
    expect(parseNavigationBody({ cafe_id: "nope" }).ok).toBe(false);
  });
});

describe("recordNavigation", () => {
  it("inserts the row in ONE statement with the visibility gate inside and deduplicates unresolved navigations", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [NAV_ROW] }); // insert…select…where exists…on conflict

    const result = await recordNavigation(USER.id, CAFE);

    expect(result).toEqual(NAV_ROW);
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("where exists");
    expect(sql).toContain("visibility");
    expect(sql).toContain("on conflict (user_id, cafe_id) where resolved = false");
    expect(sql).toContain("created_at = now()");
    expect(params).toEqual([CAFE, USER.id]);
  });

  it("throws CafeNotFoundError without a row when the cafe is missing/invisible", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // 0 rows: gate failed

    const err = await recordNavigation(USER.id, CAFE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CafeNotFoundError);
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid ids before touching the database", async () => {
    await expect(recordNavigation("not-a-uuid", CAFE)).rejects.toThrow("Invalid user ID");
    await expect(recordNavigation(USER.id, "nope")).rejects.toThrow("Invalid cafe ID");
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/navigations", () => {
  const url = "https://localhost/api/navigations";

  function postRequest(body: unknown): Request {
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("400s on an invalid body", async () => {
    const res = await navPOST(postRequest({}));
    expect(res.status).toBe(400);
  });

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await navPOST(postRequest({ cafe_id: CAFE }));
    expect(res.status).toBe(401);
  });

  it("404s when the cafe does not exist", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await navPOST(postRequest({ cafe_id: CAFE }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("201s with the recorded navigation", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [NAV_ROW] }); // single-statement insert
    const res = await navPOST(postRequest({ cafe_id: CAFE }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ id: NAV_ROW.id, resolved: false });
  });
});

describe("parsePromptAnswerBody", () => {
  it("accepts the three user answers and rejects everything else", () => {
    for (const outcome of ["visited", "wont_go", "not_yet"] as const) {
      expect(parsePromptAnswerBody({ outcome })).toEqual({ ok: true, value: { outcome } });
    }
    expect(parsePromptAnswerBody(null).ok).toBe(false);
    expect(parsePromptAnswerBody({}).ok).toBe(false);
    // "auto" is server-written only (DG79) — never user-answerable.
    expect(parsePromptAnswerBody({ outcome: "auto" }).ok).toBe(false);
    expect(parsePromptAnswerBody({ outcome: "visited", extra: 1 }).ok).toBe(true);
  });
});

describe("navigationPromptQueue", () => {
  it("next() returns the most recent eligible item with its cafe", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: NAV_ROW.id,
          created_at: NAV_ROW.created_at,
          cafe_id: CAFE,
          cafe_name: "Seed Cafe",
          cafe_cover: "cover.webp",
        },
      ],
    });
    const item = await navigationPromptQueue.next(USER.id);
    expect(item).toEqual({
      id: NAV_ROW.id,
      created_at: NAV_ROW.created_at,
      cafe: { id: CAFE, name: "Seed Cafe", cover: "cover.webp" },
    });
    // Eligibility params come from app.yaml promptQueue (DG78/DG83/DG91).
    expect(poolQueryMock.mock.calls[0][1]).toEqual([USER.id, 24, 90, 24, 2]);
  });

  it("next() returns null when nothing is eligible", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    await expect(navigationPromptQueue.next(USER.id)).resolves.toBeNull();
  });

  it("answer(visited|wont_go) resolves permanently", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(
      navigationPromptQueue.answer(USER.id, NAV_ROW.id, "wont_go"),
    ).resolves.toEqual({ status: "answered", outcome: "wont_go" });
    expect(poolQueryMock.mock.calls[0][1]).toEqual([NAV_ROW.id, USER.id, "wont_go"]);
  });

  it("answer(not_yet) stamps the re-ask delay with the configured cap", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(
      navigationPromptQueue.answer(USER.id, NAV_ROW.id, "not_yet"),
    ).resolves.toEqual({ status: "answered", outcome: "not_yet" });
    expect(poolQueryMock.mock.calls[0][1]).toEqual([NAV_ROW.id, USER.id, 2]);
  });

  it("re-answer on a resolved row returns the stored outcome (idempotent)", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // update matched nothing
      .mockResolvedValueOnce({ rows: [{ outcome: "auto" }] }); // stored outcome
    await expect(
      navigationPromptQueue.answer(USER.id, NAV_ROW.id, "visited"),
    ).resolves.toEqual({ status: "answered", outcome: "auto" });
  });

  it("answer on a missing row reports gone", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      navigationPromptQueue.answer(USER.id, NAV_ROW.id, "visited"),
    ).resolves.toEqual({ status: "gone" });
  });
});

describe("autoResolveNavigationsTx (DG79)", () => {
  it("resolves only the caller's unresolved navigations to that cafe", async () => {
    const q = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await autoResolveNavigationsTx(q, USER.id, CAFE);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("outcome = 'auto'");
    expect(sql).toContain("resolved = false");
    expect(params).toEqual([USER.id, CAFE]);
  });
});

describe("GET /api/navigations/prompt", () => {
  const url = "https://localhost/api/navigations/prompt";

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await promptGET(new Request(url));
    expect(res.status).toBe(401);
  });

  it("returns the next eligible prompt", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: NAV_ROW.id,
          created_at: NAV_ROW.created_at,
          cafe_id: CAFE,
          cafe_name: "Seed Cafe",
          cafe_cover: null,
        },
      ],
    });
    const res = await promptGET(new Request(url));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      prompt: {
        id: NAV_ROW.id,
        created_at: NAV_ROW.created_at,
        cafe: { id: CAFE, name: "Seed Cafe", cover: null },
      },
    });
  });

  it("returns prompt:null when the queue is empty", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await promptGET(new Request(url));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ prompt: null });
  });
});

describe("POST /api/navigations/[id]/resolve", () => {
  const ctx = { params: Promise.resolve({ id: NAV_ROW.id }) };

  function postRequest(body: unknown): Request {
    return new Request(`https://localhost/api/navigations/${NAV_ROW.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("400s on a bad id or body", async () => {
    const badId = await resolvePOST(postRequest({ outcome: "visited" }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(badId.status).toBe(400);
    const badBody = await resolvePOST(postRequest({ outcome: "auto" }), ctx);
    expect(badBody.status).toBe(400);
  });

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await resolvePOST(postRequest({ outcome: "visited" }), ctx);
    expect(res.status).toBe(401);
  });

  it("404s when the navigation is not the caller's", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });
    const res = await resolvePOST(postRequest({ outcome: "wont_go" }), ctx);
    expect(res.status).toBe(404);
  });

  it("resolves and echoes the outcome", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await resolvePOST(postRequest({ outcome: "visited" }), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ outcome: "visited" });
  });
});
