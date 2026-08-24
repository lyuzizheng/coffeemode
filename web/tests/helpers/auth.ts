import { vi } from "vitest";

// Keep in sync with scripts/supabase-mock.mjs:fakeJwt (identical HS256 + dummy signature).
// If you change header/payload shape, update both and add CI grep guard.
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Create a fake unsigned JWT for Supabase auth mock.
 * Header is fixed HS256, signature is a dummy value — tests that need real
 * verification should replace this with a proper signing helper.
 */
export function fakeJwt(
  userId: string,
  extra: Record<string, unknown> = {},
  expiresInSec = 3600,
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
      ...extra,
    }),
  );
  const signature = base64UrlEncode("fake-signature");
  return `${header}.${payload}.${signature}`;
}

export function decodeFakeJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid JWT");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload) as Record<string, unknown>;
}

/**
 * Stub getCurrentUser to return an authenticated user.
 * Uses vi.doMock so callers can control resolution per-test.
 * Must be called before importing the SUT in the same file, or prefer a
 * hoisted `vi.mock("@/lib/auth/get-user", ...)` at the top of the test file.
 * `vi.doMock` at call-time does not rewire an already-imported module.
 */
export function stubGetCurrentUser(user: { id: string } | null): void {
  vi.doMock("@/lib/auth/get-user", () => ({
    getCurrentUser: vi.fn().mockResolvedValue(user),
  }));
}

/**
 * Helper for unit tests that mock the Supabase server client directly.
 * Returns a mock client whose auth.getUser resolves to the given user id
 * (or null for unauthenticated).
 */
export function createMockSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        userId
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: null },
      ),
    },
  } as unknown as Awaited<ReturnType<typeof import("@/lib/auth/supabase-server").createSupabaseServerClient>>;
}

export function mockSupabaseServerClient(userId: string | null): void {
  vi.doMock("@/lib/auth/supabase-server", async (importOriginal) => {
    const original = (await importOriginal()) as typeof import("@/lib/auth/supabase-server");
    return {
      ...original,
      createSupabaseServerClient: vi.fn().mockResolvedValue(createMockSupabaseClient(userId)),
      isAuthConfigured: vi.fn().mockReturnValue(true),
    };
  });
}
