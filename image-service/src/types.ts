/**
 * Cloudflare bindings and configuration for the image service. The wire DTOs
 * this Worker speaks live in `web/shared/images/types.ts` (BRAWUKA-738), next
 * to the key layout and upload-size rules it shares with web/.
 */
export interface Env {
  IMAGE_SERVICE_TOKEN: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  /**
   * Optional S3-compatible endpoint override for local dev (e.g. MinIO at
   * http://localhost:9000). When unset, the R2 endpoint is derived from
   * R2_ACCOUNT_ID as before.
   */
  R2_ENDPOINT?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  R2_BUCKET: R2Bucket;
}
