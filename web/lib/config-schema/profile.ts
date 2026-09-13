import { fail, positiveInteger, record } from "./primitives";
import type { AppConfig } from "./types";

function parseHandleSection(file: string, value: unknown): AppConfig["profile"]["handle"] {
  const handle = record(file, "profile.handle", value);
  const minChars = positiveInteger(file, "profile.handle.minChars", handle.minChars);
  const maxChars = positiveInteger(file, "profile.handle.maxChars", handle.maxChars);
  if (minChars > maxChars) {
    fail(file, "profile.handle", `"minChars" (${minChars}) must not exceed "maxChars" (${maxChars})`);
  }
  return {
    minChars,
    maxChars,
    changeCooldownDays: positiveInteger(
      file,
      "profile.handle.changeCooldownDays",
      handle.changeCooldownDays,
    ),
    slugMaxChars: positiveInteger(file, "profile.handle.slugMaxChars", handle.slugMaxChars),
    generateMaxAttempts: positiveInteger(
      file,
      "profile.handle.generateMaxAttempts",
      handle.generateMaxAttempts,
    ),
  };
}

/** Validate the `profile` subtree of app.yaml. */
export function parseProfileSection(
  file: string,
  profile: Record<string, unknown>,
): AppConfig["profile"] {
  return {
    listLimitMax: positiveInteger(file, "profile.listLimitMax", profile.listLimitMax),
    listPageSize: positiveInteger(file, "profile.listPageSize", profile.listPageSize),
    displayNameMaxChars: positiveInteger(
      file,
      "profile.displayNameMaxChars",
      profile.displayNameMaxChars,
    ),
    recentSearchesMax: positiveInteger(
      file,
      "profile.recentSearchesMax",
      profile.recentSearchesMax,
    ),
    handle: parseHandleSection(file, profile.handle),
  };
}
