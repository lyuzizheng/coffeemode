import { positiveInteger } from "./primitives";
import type { AppConfig } from "./types";

/** Validate the `query` subtree of app.yaml (TanStack Query defaults, ms). */
export function parseQuerySection(
  file: string,
  query: Record<string, unknown>,
): AppConfig["query"] {
  return {
    staleTimeMs: positiveInteger(file, "query.staleTimeMs", query.staleTimeMs),
    gcTimeMs: positiveInteger(file, "query.gcTimeMs", query.gcTimeMs),
    persistMaxAgeMs: positiveInteger(file, "query.persistMaxAgeMs", query.persistMaxAgeMs),
  };
}
