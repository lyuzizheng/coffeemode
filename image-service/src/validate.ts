const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function sanitizeMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ascii = value
    .normalize("NFKC")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  if (ascii.length === 0) return undefined;
  return ascii.slice(0, 64);
}
