import { apiFetch } from "@/lib/http";
import type { BannerKind, RuntimeBanner, RuntimeConfig } from "@/types/runtime-config";

/**
 * Client-safe runtime-banner helpers (BRAWUKA-284).
 *
 * No `node:` imports, no `server-only` guard: imported by the banner
 * component, the `lib/db` reader, and unit tests alike. Operator JSON is
 * never trusted — every shape is guarded so one bad edit degrades to
 * "no banner" instead of a crash.
 */

const BANNER_KINDS = [
  "maintenance",
  "outage",
  "feature",
  "editorial",
] as const satisfies readonly BannerKind[];

export function isBannerKind(value: unknown): value is BannerKind {
  return (
    typeof value === "string" &&
    (BANNER_KINDS as readonly string[]).includes(value)
  );
}

function isLocaleRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string" && v.length > 0);
}

export function isRuntimeBanner(value: unknown): value is RuntimeBanner {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    isBannerKind(row.kind) &&
    isLocaleRecord(row.text) &&
    (row.href === undefined || typeof row.href === "string") &&
    (row.expiresAt === undefined || typeof row.expiresAt === "string")
  );
}

/** True when a banner is visible right now (shape + expiry only). */
export function isBannerLive(banner: RuntimeBanner, nowMs = Date.now()): boolean {
  if (banner.expiresAt === undefined) return true;
  const t = Date.parse(banner.expiresAt);
  return Number.isNaN(t) || t > nowMs;
}

/** First live banner in an untrusted payload, or null. */
export function selectLiveBanner(value: unknown, nowMs = Date.now()): RuntimeBanner | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (isRuntimeBanner(item) && isBannerLive(item, nowMs)) return item;
  }
  return null;
}

/** Localized banner copy: active locale, then en, then first available. */
export function pickBannerText(banner: RuntimeBanner, locale: string): string {
  return banner.text[locale] ?? banner.text.en ?? Object.values(banner.text)[0] ?? "";
}

/**
 * Client read of `GET /api/config` (banner path). Never throws: any failure
 * degrades to null (no banner) so the shell never breaks on config trouble.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig | null> {
  try {
    const data = await apiFetch<unknown>("/api/config", {
      headers: { accept: "application/json" },
    });
    if (typeof data !== "object" || data === null) return null;
    const row = data as Record<string, unknown>;
    return {
      banners: Array.isArray(row.banners) ? row.banners.filter(isRuntimeBanner) : [],
    };
  } catch {
    return null;
  }
}
