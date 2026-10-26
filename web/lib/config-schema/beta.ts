import { fail, flag, record, stringList } from "./primitives";
import type { AppConfig } from "./types";

/**
 * Closed-beta admission parameters (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * `enabled` is the product state, not a deployment accident: the app ships
 * closed. `BETA_MODE` in the environment flips one deployment (spec 0010 §3)
 * without editing the repo — the typing/override contract lives in
 * `lib/beta/config.ts`, this module only validates the file.
 */
export function parseBetaSection(file: string, value: unknown): AppConfig["beta"] {
  const beta = record(file, "beta", value);

  const publicPaths = stringList(file, "beta.publicPaths", beta.publicPaths);
  if (publicPaths.some((path) => !path.startsWith("/"))) {
    fail(file, "beta.publicPaths", "entries must be root-relative paths");
  }

  const inviteEmail = beta.inviteEmail;
  if (typeof inviteEmail !== "string" || !inviteEmail.includes("@")) {
    fail(file, "beta.inviteEmail", "must be an email address");
  }

  return {
    enabled: flag(file, "beta.enabled", beta.enabled),
    publicPaths,
    inviteEmail,
  };
}
