/**
 * Validates that a path is a safe relative internal route: a single leading
 * slash, never protocol-relative (`//host`) or backslash-relative
 * (`/\host` — the URL parser normalizes `\` to `/` for special schemes, so
 * the OAuth callback's `new URL(next, origin)` would redirect to
 * `https://host/`). Percent-encoded variants (`/%5c…`, `/%2f%2f…`) are
 * decoded and checked too; malformed encodings fail closed.
 */
export function isSafeReturnPath(path?: string | null): path is string {
  if (!path) return false;
  // The URL parser strips ASCII tab/CR/LF before resolving (`/%09//evil`
  // collapses to `///evil` → external), so strip them here before judging
  // the leading characters, on both the raw and single-decoded form.
  const stripped = path.replace(/[\t\n\r]/g, "");
  if (!stripped.startsWith("/")) return false;
  if (stripped[1] === "/" || stripped[1] === "\\") return false;
  try {
    const decoded = decodeURIComponent(stripped).replace(/[\t\n\r]/g, "");
    if (decoded[1] === "/" || decoded[1] === "\\") return false;
  } catch {
    // Benign: malformed percent-encoding cannot be proven internal.
    return false;
  }
  return true;
}
