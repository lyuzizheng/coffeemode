import { positiveInteger, positiveNumber } from "./primitives";
import type { AppConfig } from "./types";

/** Validate the `checkins` subtree of app.yaml. */
export function parseCheckinsSection(
  file: string,
  checkins: Record<string, unknown>,
): AppConfig["checkins"] {
  return {
    photoCap: positiveInteger(file, "checkins.photoCap", checkins.photoCap),
    noteMaxChars: positiveInteger(file, "checkins.noteMaxChars", checkins.noteMaxChars),
    pendingDraftTtlHours: positiveInteger(
      file,
      "checkins.pendingDraftTtlHours",
      checkins.pendingDraftTtlHours,
    ),
    revisitWindowHours: positiveNumber(
      file,
      "checkins.revisitWindowHours",
      checkins.revisitWindowHours,
    ),
  };
}
