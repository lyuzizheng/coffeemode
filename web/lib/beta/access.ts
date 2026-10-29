import "server-only";

import { createHash } from "node:crypto";
import { isBetaEmailAllowed } from "@/lib/db/beta";
import { emitTelemetryLine } from "@/lib/observability/server-log";

/**
 * The closed-beta admission decision (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * One function answers "may this identity use the product", and every server
 * boundary asks it — session establishment (`completeSignIn`), the API wrapper
 * (`guard`), and the page proxy. No client-side flag exists: hiding a button
 * is not a gate.
 *
 * An identity with no email address (anonymous session, provider without an
 * email claim) is refused: the beta is invitation-only, and an invitation is
 * an email address.
 */

export type BetaDenialReason = "not_allowlisted" | "no_email";
export type BetaDecision =
  | { allowed: true }
  | { allowed: false; reason: BetaDenialReason };

/**
 * Decide for one identity. `email` is whatever the verified session carries;
 * `null`/`undefined`/blank refuses without a database read.
 *
 * No process-local cache exists on purpose (BRAWUKA-972 criterion 1): a
 * revoke must refuse the NEXT request, and any cache of an `allowed` answer
 * would keep a revoked account inside for its TTL. The only query this
 * costs is a primary-key lookup on `beta_allowlist`, and only for a request
 * that already carries a verified session — anonymous traffic never gets
 * here.
 */
export async function betaDecisionFor(email: string | null | undefined): Promise<BetaDecision> {
  const normalized = email?.trim().toLowerCase() ?? "";
  if (normalized === "") return { allowed: false, reason: "no_email" };

  const allowed = await isBetaEmailAllowed(normalized);
  return allowed ? { allowed: true } : { allowed: false, reason: "not_allowlisted" };
}

/**
 * Audit trail for a refused attempt (`beta.denied`, spec 0011 D6/D7).
 *
 * The address is recorded only as a truncated SHA-256 digest: the log answers
 * "did this person try, and why were they refused" without writing personal
 * data — or any token, session, or provider payload — into stdout, Loki, or a
 * terminal transcript.
 */
export function recordBetaDenied(fields: {
  email: string | null | undefined;
  reason: BetaDenialReason;
  route: string;
  requestId?: string | null;
}): void {
  const email = fields.email?.trim().toLowerCase() ?? "";
  emitTelemetryLine({
    type: "beta.denied",
    request_id: fields.requestId ?? null,
    route: fields.route,
    reason: fields.reason,
    email_hash: email === "" ? null : hashBetaEmail(email),
  });
}

/** Stable, non-reversible audit digest of an address (16 hex chars). */
export function hashBetaEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}
