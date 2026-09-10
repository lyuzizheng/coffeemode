/**
 * Low-level config validators shared by the sibling `config-schema` modules.
 * Every helper throws a `config <file>: "<keyPath>" <reason>` error so a bad
 * config fails fast at startup with the offending path. Used by both
 * `rate-limits.ts` and `app.ts` (two consumers — no single-use fragment).
 */

export function fail(file: string, keyPath: string, reason: string): never {
  throw new Error(`config ${file}: "${keyPath}" ${reason}`);
}

export function positiveNumber(file: string, keyPath: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(file, keyPath, "must be a positive number");
  }
  return value;
}

export function positiveInteger(file: string, keyPath: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(file, keyPath, "must be a positive integer");
  }
  return value;
}

/** A number bounded between min and max inclusive. */
export function boundedNumber(
  file: string,
  keyPath: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(file, keyPath, `must be a number between ${min} and ${max}`);
  }
  return value;
}

/** A latitude/longitude number bounded to [-limit, limit]. */
export function coordinate(file: string, keyPath: string, value: unknown, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    fail(file, keyPath, `must be a number within [-${limit},${limit}]`);
  }
  return value;
}

export function record(file: string, keyPath: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(file, keyPath, "must be a mapping");
  }
  return value as Record<string, unknown>;
}

export function flag(file: string, keyPath: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    fail(file, keyPath, "must be a boolean");
  }
  return value;
}

export function stringList(file: string, keyPath: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length === 0)) {
    fail(file, keyPath, "must be a list of non-empty strings");
  }
  return [...value] as string[];
}

export function statusList(file: string, keyPath: string, value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 100 || v > 599)
  ) {
    fail(file, keyPath, "must be a non-empty list of HTTP status codes");
  }
  return [...value] as number[];
}
