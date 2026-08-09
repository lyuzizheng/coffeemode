import { METADATA_MAX_LENGTH } from "./constants";

export function sanitizeMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ascii = value
    .normalize("NFKC")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  if (ascii.length === 0) return undefined;
  return ascii.slice(0, METADATA_MAX_LENGTH);
}
