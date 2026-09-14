import "server-only";

import { query } from "./postgres";
import {
  isBannerLive,
  isFlagsRecord,
  isRuntimeBanner,
} from "@/lib/runtime-banners";
import type { RuntimeConfig } from "@/types/runtime-config";

/**
 * Runtime operator content reader (BRAWUKA-284): announcement banners +
 * feature flags readable without a redeploy. Build-time parameters stay in
 * `web/config/app.yaml`; security / rate-limit / auth parameters MUST NEVER
 * live here. Reads are public-safe values only; shape guards live in
 * `lib/runtime-banners.ts` (single source with the client).
 */

export const RUNTIME_CONFIG_KEYS = ["banners", "flags"] as const;

/**
 * Read the full runtime config. Unknown keys/rows are ignored (never throw):
 * one bad operator edit must not 500 the whole surface. Expired banners are
 * dropped; rows failing the shape guard are dropped.
 */
export async function getRuntimeConfig(now = new Date()): Promise<RuntimeConfig> {
  const { rows } = await query<{ key: string; value: unknown }>(
    "select key, value from runtime_config where key = any($1)",
    [Array.from(RUNTIME_CONFIG_KEYS)],
  );
  const byKey: Record<string, unknown> = {};
  for (const row of rows) byKey[row.key] = row.value;
  const flags = isFlagsRecord(byKey.flags) ? { ...byKey.flags } : {};
  const nowMs = now.getTime();
  const banners = Array.isArray(byKey.banners)
    ? byKey.banners.filter(isRuntimeBanner).filter((b) => isBannerLive(b, nowMs))
    : [];
  return { flags, banners };
}
