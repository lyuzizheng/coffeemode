/**
 * Store address for the image Worker's bindings — the policy both signing
 * paths (`r2Endpoint`, `presignConfig` in `./r2.ts`) read, BRAWUKA-795.
 *
 * Dependency-free and free of Cloudflare globals on purpose: `./types.ts`
 * types the `R2_BUCKET` binding with the platform's `R2Bucket`, which only
 * exists in the Worker's own program, so the address policy lives here where
 * the gated storage suite (`web/tests/integration/image-service-store-location
 * .integration.test.ts`) can drive it — and adding a global to this file would
 * break `web`'s typecheck loudly instead of drifting silently.
 */
import type { StoreLocation } from "../../web/shared/images/presign";

/**
 * The storage bindings the address needs, exactly as `wrangler.toml` declares
 * them; `Env` satisfies this structurally.
 */
export interface StoreBindings {
  /**
   * S3-compatible endpoint override for local dev (MinIO). Staging and
   * production ship `""` here to mean "no override".
   */
  R2_ENDPOINT?: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}

/** The R2 endpoint derived from the account id — the deployed store. */
export function derivedR2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Emptiness — not nullishness — selects the override: `wrangler.toml` ships
 * `R2_ENDPOINT = ""` to staging and production, and a `??` fallback turned
 * that into the address `/bucket/key`, so every upload/complete presign threw
 * on URL parsing and returned 500 (BRAWUKA-795).
 */
export function storeLocation(bindings: StoreBindings): StoreLocation {
  return {
    endpoint: bindings.R2_ENDPOINT || derivedR2Endpoint(bindings.R2_ACCOUNT_ID),
    bucket: bindings.R2_BUCKET_NAME,
  };
}
