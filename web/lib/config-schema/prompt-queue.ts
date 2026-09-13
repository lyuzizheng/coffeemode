import { positiveInteger, positiveNumber } from "./primitives";
import type { AppConfig } from "./types";

/** Validate the `promptQueue` subtree of app.yaml (DG78/DG83/DG91). */
export function parsePromptQueueSection(
  file: string,
  promptQueue: Record<string, unknown>,
): AppConfig["promptQueue"] {
  return {
    minAgeHours: positiveNumber(file, "promptQueue.minAgeHours", promptQueue.minAgeHours),
    expiryDays: positiveInteger(file, "promptQueue.expiryDays", promptQueue.expiryDays),
    reaskDelayHours: positiveNumber(
      file,
      "promptQueue.reaskDelayHours",
      promptQueue.reaskDelayHours,
    ),
    maxReasks: positiveInteger(file, "promptQueue.maxReasks", promptQueue.maxReasks),
    autoCollapseMs: positiveInteger(
      file,
      "promptQueue.autoCollapseMs",
      promptQueue.autoCollapseMs,
    ),
  };
}
