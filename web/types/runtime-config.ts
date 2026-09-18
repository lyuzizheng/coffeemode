/**
 * Runtime operator content shapes (BRAWUKA-284).
 *
 * Type-only module: safe to import from client components. Build-time
 * parameters stay in `web/config/app.yaml`; security / rate-limit / auth
 * parameters MUST NEVER take these shapes.
 */

/** Manifesto principle 3: only operational notices, never promotions. */
export type BannerKind = "maintenance" | "outage" | "feature" | "editorial";

export interface RuntimeBanner {
  id: string;
  kind: BannerKind;
  /** Locale-keyed copy; the UI renders the active locale, falling back to en. */
  text: Record<string, string>;
  href?: string;
  /** ISO timestamp; absent means active until removed. */
  expiresAt?: string;
}

export interface RuntimeConfig {
  banners: RuntimeBanner[];
}
