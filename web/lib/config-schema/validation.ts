import { positiveInteger } from "./primitives";
import type { AppConfig } from "./types";

/** Validate the `validation` subtree of app.yaml (server field-length caps). */
export function parseValidationSection(
  file: string,
  validation: Record<string, unknown>,
): AppConfig["validation"] {
  return {
    cafeAddressMaxChars: positiveInteger(
      file,
      "validation.cafeAddressMaxChars",
      validation.cafeAddressMaxChars,
    ),
    profileCityMaxChars: positiveInteger(
      file,
      "validation.profileCityMaxChars",
      validation.profileCityMaxChars,
    ),
  };
}
