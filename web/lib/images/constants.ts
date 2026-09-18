/**
 * Public CDN hosts for processed image variants.
 *
 * The image-service Worker uploads `original`, `card`, and `thumbnail` WebP
 * variants to R2; this host is served through Cloudflare and cached as
 * immutable by both the CDN and the service worker.
 *
 * Per spec 0005 §3, production and staging use isolated R2 buckets and hosts:
 * - Production: `images.cafemood.app` (bucket: `coffeemode-images-prod`)
 * - Staging:    `staging-images.cafemood.app` (bucket: `coffeemode-images-staging`)
 *
 * `R2_ALLOWED_PUBLIC_HOSTS` is the single source of truth for allowed public CDN hosts.
 *
 * When bundled into the service worker or client, `resolveR2PublicHost` safely reads
 * `NEXT_PUBLIC_R2_PUBLIC_URL` without crashing if `process` is undefined.
 *
 * This module must stay free of imports (even relative ones): `next.config.ts`
 * imports it, and Next's config transpiler cannot resolve TypeScript modules
 * outside the file itself. The shared upload cap lives in
 * `web/shared/images/constants.ts`; `web/lib/images/processor.ts`
 * imports it directly.
 */
export const R2_PUBLIC_HOST_PROD = "images.cafemood.app";
export const R2_PUBLIC_HOST_STAGING = "staging-images.cafemood.app";

export const R2_ALLOWED_PUBLIC_HOSTS = [
  R2_PUBLIC_HOST_PROD,
  R2_PUBLIC_HOST_STAGING,
] as const;

export type R2PublicHost = (typeof R2_ALLOWED_PUBLIC_HOSTS)[number];

/**
 * Resolves the active public R2 CDN host for the current environment.
 * Prioritizes `rawUrl`, then `NEXT_PUBLIC_R2_PUBLIC_URL` / `APP_ENV`,
 * defaulting to production `images.cafemood.app`.
 */
export function resolveR2PublicHost(rawUrl?: string, appEnv?: string): string {
  const candidate =
    rawUrl ??
    (typeof process !== "undefined" && typeof process.env !== "undefined"
      ? (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ||
         ((appEnv ?? process.env.APP_ENV) === "staging" ? R2_PUBLIC_HOST_STAGING : undefined))
      : undefined);

  if (!candidate) {
    return R2_PUBLIC_HOST_PROD;
  }
  try {
    const host = new URL(candidate.includes("://") ? candidate : `https://${candidate}`).hostname;
    if ((R2_ALLOWED_PUBLIC_HOSTS as readonly string[]).includes(host)) {
      return host;
    }
  } catch {
    // Malformed URL falls back to prod host
  }
  return R2_PUBLIC_HOST_PROD;
}

/**
 * Active public CDN host for current build/runtime.
 * Evaluates safely across Node, browser, and ServiceWorker contexts.
 */
export const R2_PUBLIC_HOST = resolveR2PublicHost();

/** Absolute public CDN URL for an R2 object key (leading slash tolerated). */
export function r2PublicUrl(key: string, host = R2_PUBLIC_HOST): string {
  const clean = key.startsWith("/") ? key.slice(1) : key;
  return `https://${host}/${clean}`;
}

/**
 * Build-time drift guard, called from `next.config.ts`: when
 * `NEXT_PUBLIC_R2_PUBLIC_URL` is set, its host must be in `R2_ALLOWED_PUBLIC_HOSTS`
 * and must match the explicit `APP_ENV` if specified.
 */
export function assertR2PublicUrlMatches(
  raw: string | undefined,
  appEnv?: string,
): string | undefined {
  if (!raw) return undefined;
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    throw new Error(`Invalid NEXT_PUBLIC_R2_PUBLIC_URL: ${JSON.stringify(raw)}`);
  }

  const env =
    appEnv ??
    (typeof process !== "undefined" && typeof process.env !== "undefined"
      ? process.env.APP_ENV
      : undefined);

  if (env === "staging") {
    if (host !== R2_PUBLIC_HOST_STAGING) {
      throw new Error(
        `NEXT_PUBLIC_R2_PUBLIC_URL host "${host}" does not match staging R2 host ` +
          `"${R2_PUBLIC_HOST_STAGING}" (APP_ENV=staging).`,
      );
    }
    return host;
  }

  if (env === "production") {
    if (host !== R2_PUBLIC_HOST_PROD) {
      throw new Error(
        `NEXT_PUBLIC_R2_PUBLIC_URL host "${host}" does not match production R2 host ` +
          `"${R2_PUBLIC_HOST_PROD}" (APP_ENV=production).`,
      );
    }
    return host;
  }

  if (!(R2_ALLOWED_PUBLIC_HOSTS as readonly string[]).includes(host)) {
    throw new Error(
      `NEXT_PUBLIC_R2_PUBLIC_URL host "${host}" does not match any allowed R2 public host ` +
        `(${R2_ALLOWED_PUBLIC_HOSTS.join(", ")}). The constant is the ` +
        `single source — update it in web/lib/images/constants.ts.`,
    );
  }
  return host;
}
