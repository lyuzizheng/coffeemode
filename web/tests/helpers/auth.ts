import { vi } from "vitest";
import {
  decodeFakeJwt as decodeSharedJwt,
  fakeJwt as mintSharedJwt,
} from "../../../scripts/fake-jwt.mjs";

// Single source of truth for the fake-JWT shape: `scripts/fake-jwt.mjs`
// (spec 0010 §3 G4). Thin typed wrappers — no JWT logic lives here; the
// compose mock (`scripts/supabase-mock.mjs`) imports the same file, so a
// shape change lands in both places from one edit. (Wrappers, not
// `export … from`: Vite drops re-exported names from `.mjs` outside root.)
export function fakeJwt(
  userId: string,
  extra: Record<string, unknown> = {},
  expiresInSec = 3600,
): string {
  return mintSharedJwt(userId, extra, expiresInSec);
}

export function decodeFakeJwt(token: string): Record<string, unknown> {
  return decodeSharedJwt(token) as Record<string, unknown>;
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
