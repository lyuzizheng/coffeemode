import { positiveInteger, record } from "./primitives";
import type { AppConfig } from "./types";

type RuntimeConfig = AppConfig["runtimeConfig"];

/** Validate the `runtimeConfig` subtree of app.yaml (BRAWUKA-284). */
export function parseRuntimeConfigSection(
  file: string,
  runtimeConfig: Record<string, unknown>,
): RuntimeConfig {
  const responseCache = record(file, "runtimeConfig.responseCache", runtimeConfig.responseCache);
  return {
    responseCache: {
      sMaxAgeSeconds: positiveInteger(
        file,
        "runtimeConfig.responseCache.sMaxAgeSeconds",
        responseCache.sMaxAgeSeconds,
      ),
      staleWhileRevalidateSeconds: positiveInteger(
        file,
        "runtimeConfig.responseCache.staleWhileRevalidateSeconds",
        responseCache.staleWhileRevalidateSeconds,
      ),
    },
  };
}
