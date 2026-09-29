/**
 * OAuth provider registry (BRAWUKA-789) — the single source for which
 * provider ids exist. Render order is NOT owned here: `auth.providers` in
 * `config/app.yaml` decides which of these appear on the sign-in surfaces
 * and in what order (first = primary). Import-free by construction so both
 * the server action and the client env channel can share it.
 */

export const OAUTH_PROVIDERS = ["apple", "google"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

