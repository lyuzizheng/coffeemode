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

