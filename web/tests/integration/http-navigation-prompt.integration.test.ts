/**
 * @vitest-environment node
 * BRAWUKA-818: the return-visit prompt endpoint must answer a guest without a
 * session with 200 `{ prompt: null }`, not the 401 the anonymous cafe detail
 * turned into a console network error. The authenticated path stays a real
 * queue read (`navigationPromptQueue` semantics are proven in db.integration).
 *
 * Real Postgres through the route handler: the guest case proves no row leaks
 * (an eligible queue row for another identity stays invisible), and the signed
 * case proves the same request still serves that row — the guard change is the
 * only variable.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as promptGET } from "@/app/api/navigations/prompt/route";
import {
  setupTestDatabase,
  teardownTestDatabase,
  type TestDatabaseContext,
} from "../helpers/db";
import {
  apiClient,
  createHttpTestUsers,
  seedHttpTestUsers,
  type HttpTestUsers,
} from "../helpers/http-client";

// The harness programs identity on this seam; the route wrapper reads it.
vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: vi.fn() }));

const describeIntegration = process.env.RUN_INTEGRATION === "1" ? describe : describe.skip;

interface PromptBody {
  prompt: { id: string; cafe: { id: string; name: string } } | null;
}

let db: TestDatabaseContext | undefined;
let users: HttpTestUsers;

async function seedCafe(): Promise<string> {
  const id = randomUUID();
  await db!.dbClient.query(
    `insert into cafes (id, name, location, city, tz)
     values ($1, 'Seed Cafe', ST_SetSRID(ST_MakePoint(103.83, 1.30), 4326)::geography,
             'singapore', 'Asia/Singapore')`,
    [id],
  );
  return id;
}

/** Yesterday-dated navigation: past minAgeHours (24), inside expiryDays (90). */
async function seedEligibleNavigation(cafeId: string, userId: string): Promise<string> {
  const { rows } = await db!.dbClient.query(
    `insert into navigations (cafe_id, user_id, resolved, created_at)
     values ($1, $2, false, now() - interval '25 hours')
     returning id`,
    [cafeId, userId],
  );
  return rows[0].id as string;
}

describeIntegration("anonymous navigation-prompt contract (BRAWUKA-818)", () => {
  beforeAll(async () => {
    db = await setupTestDatabase("coffeemode_test_nav_prompt");
    users = createHttpTestUsers();
    await seedHttpTestUsers(db.dbClient, users);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(db);
  });

  it("answers a guest with 200 {prompt:null} and never serves another identity's queue", async () => {
    const cafeId = await seedCafe();
    await seedEligibleNavigation(cafeId, users.userA.id);

    const guest = await apiClient().asGuest().get<PromptBody>(promptGET, "/api/navigations/prompt");

    expect(guest.status).toBe(200);
    expect(guest.data).toEqual({ prompt: null });
  });

  it("still serves the eligible prompt to the signed-in caller", async () => {
    const cafeId = await seedCafe();
    const navigationId = await seedEligibleNavigation(cafeId, users.userB.id);

    const signed = await apiClient(users.userB).get<PromptBody>(promptGET, "/api/navigations/prompt");

    expect(signed.status).toBe(200);
    expect(signed.data.prompt?.id).toBe(navigationId);
    expect(signed.data.prompt?.cafe.id).toBe(cafeId);
  });
});
