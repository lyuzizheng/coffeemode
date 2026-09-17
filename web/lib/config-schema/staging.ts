import { positiveInteger, record } from "./primitives";
import type { AppConfig } from "./types";

type StagingConfig = AppConfig["staging"];

/** Validate the `staging` subtree of app.yaml (spec 0010 S4). */
export function parseStagingSection(
  file: string,
  staging: Record<string, unknown>,
): StagingConfig {
  const inner = record(file, "staging", staging);
  return {
    maxWorkers: positiveInteger(file, "staging.maxWorkers", inner.maxWorkers),
  };
}
