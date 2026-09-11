import { boundedNumber, positiveInteger, record } from "./primitives";
import type { AppConfig } from "./types";

type BudgetsConfig = AppConfig["budgets"];

function parseBundleLimits(file: string, value: unknown): BudgetsConfig["bundle"] {
  const bundle = record(file, "budgets.bundle", value);
  return {
    maxJsChunkBytes: positiveInteger(
      file,
      "budgets.bundle.maxJsChunkBytes",
      bundle.maxJsChunkBytes,
    ),
    maxCssChunkBytes: positiveInteger(
      file,
      "budgets.bundle.maxCssChunkBytes",
      bundle.maxCssChunkBytes,
    ),
    maxTotalStaticBytes: positiveInteger(
      file,
      "budgets.bundle.maxTotalStaticBytes",
      bundle.maxTotalStaticBytes,
    ),
  };
}

function parseLighthouseScores(file: string, value: unknown): BudgetsConfig["lighthouse"] {
  const lighthouse = record(file, "budgets.lighthouse", value);
  return {
    performance: boundedNumber(
      file,
      "budgets.lighthouse.performance",
      lighthouse.performance,
      0,
      1,
    ),
    accessibility: boundedNumber(
      file,
      "budgets.lighthouse.accessibility",
      lighthouse.accessibility,
      0,
      1,
    ),
    bestPractices: boundedNumber(
      file,
      "budgets.lighthouse.bestPractices",
      lighthouse.bestPractices,
      0,
      1,
    ),
    seo: boundedNumber(file, "budgets.lighthouse.seo", lighthouse.seo, 0, 1),
  };
}

/** Validate the `budgets` subtree of app.yaml. */
export function parseBudgetsSection(
  file: string,
  budgets: Record<string, unknown>,
): BudgetsConfig {
  return {
    bundle: parseBundleLimits(file, budgets.bundle),
    lighthouse: parseLighthouseScores(file, budgets.lighthouse),
  };
}
