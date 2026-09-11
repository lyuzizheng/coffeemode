import { fail, positiveInteger, positiveNumber, record } from "./primitives";
import type { AppConfig } from "./types";

type SearchConfig = AppConfig["search"];

function parseRelevanceWeights(
  file: string,
  value: unknown,
): SearchConfig["relevanceWeights"] {
  const weights = record(file, "search.relevanceWeights", value);
  return {
    exactNameMatch: positiveNumber(
      file,
      "search.relevanceWeights.exactNameMatch",
      weights.exactNameMatch,
    ),
    prefixMatch: positiveNumber(
      file,
      "search.relevanceWeights.prefixMatch",
      weights.prefixMatch,
    ),
    fuzzyMatch: positiveNumber(
      file,
      "search.relevanceWeights.fuzzyMatch",
      weights.fuzzyMatch,
    ),
    secondaryMatch: positiveNumber(
      file,
      "search.relevanceWeights.secondaryMatch",
      weights.secondaryMatch,
    ),
  };
}

function parseExternalSources(file: string, value: unknown): SearchConfig["externalSources"] {
  if (value === undefined) return { google: true, apple: false };
  const es = record(file, "search.externalSources", value);
  if (typeof es.google !== "boolean" || typeof es.apple !== "boolean") {
    fail(file, "search.externalSources", "must be {google:boolean, apple:boolean}");
  }
  return { google: es.google, apple: es.apple };
}

function parseRankingMode(file: string, value: unknown): string {
  if (value === undefined) return "relevance";
  if (value !== "relevance" && value !== "good_first") {
    fail(file, "search.rankingMode", "must be \"relevance\" or \"good_first\"");
  }
  return value as string;
}

/** Validate the `search` subtree of app.yaml. */
export function parseSearchSection(file: string, search: Record<string, unknown>): SearchConfig {
  return {
    maxRadiusKm: positiveNumber(file, "search.maxRadiusKm", search.maxRadiusKm),
    defaultSuggestionLimit: positiveInteger(
      file,
      "search.defaultSuggestionLimit",
      search.defaultSuggestionLimit,
    ),
    maxSuggestionLimit: positiveInteger(
      file,
      "search.maxSuggestionLimit",
      search.maxSuggestionLimit,
    ),
    weakResultsThreshold: positiveInteger(
      file,
      "search.weakResultsThreshold",
      search.weakResultsThreshold,
    ),
    dbFetchCap: positiveInteger(file, "search.dbFetchCap", search.dbFetchCap),
    maxIterativeFetchBatches: positiveInteger(
      file,
      "search.maxIterativeFetchBatches",
      search.maxIterativeFetchBatches,
    ),
    minPoiQueryLength: positiveInteger(
      file,
      "search.minPoiQueryLength",
      search.minPoiQueryLength,
    ),
    relevanceWeights: parseRelevanceWeights(file, search.relevanceWeights),
    minRelevanceScore:
      search.minRelevanceScore === undefined
        ? 50
        : positiveInteger(file, "search.minRelevanceScore", search.minRelevanceScore),
    externalSources: parseExternalSources(file, search.externalSources),
    rankingMode: parseRankingMode(file, search.rankingMode),
  };
}
