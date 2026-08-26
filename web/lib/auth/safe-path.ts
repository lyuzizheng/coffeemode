/**
 * Validates that a path is a safe relative internal route starting with a single slash (no protocol-relative //).
 */
export function isSafeReturnPath(path?: string | null): path is string {
  if (!path) return false;
  return path.startsWith("/") && !path.startsWith("//");
}
