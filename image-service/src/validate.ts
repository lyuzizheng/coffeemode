import { METADATA_MAX_LENGTH, PROVISION_TARGET_TYPE } from "./constants";
import { isValidUUID } from "../../web/shared/uuid";
import type { ErrorCode } from "../../web/shared/errors";
import type { CompleteRequest, CompleteStageType } from "../../web/shared/images/types";

export function sanitizeMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ascii = value
    .normalize("NFKC")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  if (ascii.length === 0) return undefined;
  return ascii.slice(0, METADATA_MAX_LENGTH);
}

/**
 * `POST /v1/images/complete` parsing — raw request JSON is untrusted, so the
 * handler never casts it to the wire DTO; it reads `unknown` fields and only
 * the values validated here reach the DTO (BRAWUKA-738).
 *
 * Stage metadata is REQUIRED (issue #158 cleanup contract): complete() stamps
 * it onto the re-PUT original, so a completed original without a marker would
 * be deletable. Two stages are accepted:
 *   - provision: targetType="provision", targetId=<imageUuid> — the creation
 *     flow processes images BEFORE their cafe/check-in target exists
 *     (issue #86); attachProvisionedPhotos restamps via restampOriginal
 *     with the real target once it exists.
 *   - final: targetType="cafe"|"checkin" + target id — live gallery original.
 * The cleanup script treats "provision"-stage objects older than retention
 * as abandoned (an upload that never attached) and keeps cafe/checkin ones.
 */
export type CompleteParse =
  | { ok: true; request: CompleteRequest }
  | { ok: false; code: ErrorCode; message: string };

function isCompleteStageType(value: string): value is CompleteStageType {
  return value === PROVISION_TARGET_TYPE || value === "cafe" || value === "checkin";
}

export function parseCompleteRequest(body: Record<string, unknown>): CompleteParse {
  const imageUuid = body.imageUuid;
  if (!isValidUUID(imageUuid)) {
    return { ok: false, code: "invalid_request", message: "imageUuid must be a valid UUID" };
  }
  const userId = sanitizeMetadata(body.userId);
  const targetType = sanitizeMetadata(body.targetType);
  const targetId = sanitizeMetadata(body.targetId);
  if (!targetType || !targetId) {
    return { ok: false, code: "invalid_request", message: "targetType and targetId are required" };
  }
  if (!isCompleteStageType(targetType)) {
    return { ok: false, code: "invalid_request", message: "targetType must be provision, cafe, or checkin" };
  }
  // Keys are always lowercase (normalizedUuid); the provision marker must
  // match the key case so metadata and key stay consistent (BRAWUKA-455).
  const normalizedUuid = imageUuid.toLowerCase();
  return {
    ok: true,
    request: {
      imageUuid: normalizedUuid,
      userId,
      targetType,
      // Provision-stage marker pairs the object with itself: unique per
      // upload, never collides with a real cafe/checkin UUID.
      targetId: targetType === PROVISION_TARGET_TYPE ? normalizedUuid : targetId,
    },
  };
}
