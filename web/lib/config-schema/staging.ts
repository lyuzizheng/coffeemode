import { positiveInteger } from "./primitives";
import type { AppConfig } from "./types";

type StagingConfig = AppConfig["staging"];

/** Validate the `staging` subtree of app.yaml (spec 0010 S4). */
export function parseStagingSection(
  file: string,
  staging: Record<string, unknown>,
): StagingConfig {
  return {
    maxWorkers: positiveInteger(file, "staging.maxWorkers", staging.maxWorkers),
  };
}
