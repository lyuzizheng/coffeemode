import { positiveInteger } from "./primitives";
import type { AppConfig } from "./types";

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
  };
}
