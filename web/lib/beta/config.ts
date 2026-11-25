import { appConfig } from "@/lib/config";

/**
 * Closed-beta admission policy knobs (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * Server-only in practice (it reads `lib/config`, which carries the guard):
 * imported by the proxy too, so keep it free of `server-only`, `next/*`, and
 * Node-only imports — the proxy bundle is its own module graph.
 *
 * Two sources, one meaning:
 * - `beta.enabled` in `web/config/app.yaml` is the PRODUCT state (the app
 *   ships closed);
 * - `BETA_MODE` in the environment flips one deployment (spec 0010 §3). A
 *   test harness or a staging journey sets `0`; production never needs it.
 * `BETA_MODE` wins whenever it is set, and an unrecognized value throws at the
 * first request instead of guessing — a security gate must not degrade to a
 * typo.
 */

const ENV_FLAG = "BETA_MODE";
/** Accepted spellings and their meaning; anything else is a config error. */
const FLAG_VALUES: Record<string, boolean> = {
  "1": true,
  "on": true,
  "true": true,
  "yes": true,
  "0": false,
  "off": false,
  "false": false,
  "no": false,
};

/** Read the deployment override. Exported for the ops docs' contract test. */
export function betaModeOverride(): boolean | null {
  const raw = process.env[ENV_FLAG]?.trim().toLowerCase();
  if (!raw) return null;
  if (Object.hasOwn(FLAG_VALUES, raw)) return FLAG_VALUES[raw];
  throw new Error(
    `${ENV_FLAG} must be one of ${Object.keys(FLAG_VALUES).join(", ")} — got "${raw}"`,
  );
}

/** True while the app refuses anyone who is not on the beta allowlist. */
export function isBetaEnabled(): boolean {
  return betaModeOverride() ?? appConfig.beta.enabled;
}

/**
 * Page paths reachable while the gate is on: the beta surface, the legal pages
 * (privacy/terms must stay readable to anyone who is asked to sign in), the
 * crawler files, the offline shell (served exactly when the network — and
 * therefore this gate — is unreachable), and the OAuth/OTP redirect target.
 *
 * Exact match only: a prefix rule would open every child of a listed path by
 * accident. A trailing slash is normalized away, so `/beta/` matches `/beta`.
 */
export function isBetaPublicPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return appConfig.beta.publicPaths.includes(normalized);
}

/** Invitation inbox for the beta page's request link. */
export function betaInviteEmail(): string {
  return appConfig.beta.inviteEmail;
}
