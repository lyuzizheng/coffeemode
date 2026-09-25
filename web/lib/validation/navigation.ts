import "server-only";

import { isValidUUID } from "@shared/uuid";
import type { PromptAnswer } from "@/lib/prompt-queue";
import { fail, type ParseResult } from "./common";

/** Validate the POST /api/navigations body. */
export function parseNavigationBody(body: unknown): ParseResult<{ cafe_id: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const cafeId = (body as Record<string, unknown>).cafe_id;
  if (typeof cafeId !== "string" || !isValidUUID(cafeId)) {
    return fail("cafe_id (UUID string) required");
  }
  return { ok: true, value: { cafe_id: cafeId } };
}

/** Validate the POST /api/navigations/[id]/resolve body. */
export function parsePromptAnswerBody(body: unknown): ParseResult<{ outcome: PromptAnswer }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome !== "visited" && outcome !== "wont_go" && outcome !== "not_yet") {
    return fail("outcome must be one of: visited, wont_go, not_yet");
  }
  return { ok: true, value: { outcome } };
}
