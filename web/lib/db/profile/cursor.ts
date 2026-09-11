import "server-only";

import { isValidUUID } from "@shared/uuid";

export class ProfileCursorError extends Error {
  constructor(message = "invalid cursor") {
    super(message);
    this.name = "ProfileCursorError";
  }
}

export function parseProfileCursor(cursor: string): { visitedAt: string; id: string } {
  const parts = cursor.split("_");
  if (parts.length !== 2) {
    throw new ProfileCursorError();
  }
  const [cursorVisitedAt, cursorId] = parts;
  if (
    !cursorVisitedAt ||
    !cursorId ||
    !isValidUUID(cursorId) ||
    Number.isNaN(Date.parse(cursorVisitedAt))
  ) {
    throw new ProfileCursorError();
  }
  return { visitedAt: cursorVisitedAt, id: cursorId };
}
