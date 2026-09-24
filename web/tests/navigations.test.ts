import { describe, expect, it } from "vitest";
import {
  parseNavigationBody,
  parsePromptAnswerBody,
} from "@/lib/validation/navigation";
import { fail } from "@/lib/validation/common";

describe("navigation validation", () => {
  const VALID_UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  describe("parseNavigationBody", () => {
    it("rejects non-object payloads", () => {
      expect(parseNavigationBody(null)).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parseNavigationBody([])).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parseNavigationBody("string")).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parseNavigationBody(123)).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parseNavigationBody(undefined)).toEqual({
        ok: false,
        message: "object body required",
      });
    });

    it("rejects missing or invalid cafe_id", () => {
      expect(parseNavigationBody({})).toEqual({
        ok: false,
        message: "cafe_id (UUID string) required",
      });
      expect(parseNavigationBody({ cafe_id: 12345 })).toEqual({
        ok: false,
        message: "cafe_id (UUID string) required",
      });
      expect(parseNavigationBody({ cafe_id: "not-a-uuid" })).toEqual({
        ok: false,
        message: "cafe_id (UUID string) required",
      });
      expect(parseNavigationBody({ cafe_id: "" })).toEqual({
        ok: false,
        message: "cafe_id (UUID string) required",
      });
    });

    it("accepts valid UUID cafe_id", () => {
      expect(parseNavigationBody({ cafe_id: VALID_UUID })).toEqual({
        ok: true,
        value: { cafe_id: VALID_UUID },
      });
    });
  });

  describe("parsePromptAnswerBody", () => {
    it("rejects non-object payloads", () => {
      expect(parsePromptAnswerBody(null)).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parsePromptAnswerBody([])).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parsePromptAnswerBody("visited")).toEqual({
        ok: false,
        message: "object body required",
      });
      expect(parsePromptAnswerBody(undefined)).toEqual({
        ok: false,
        message: "object body required",
      });
    });

    it("rejects missing or unsupported outcome values", () => {
      expect(parsePromptAnswerBody({})).toEqual({
        ok: false,
        message: "outcome must be one of: visited, wont_go, not_yet",
      });
      expect(parsePromptAnswerBody({ outcome: "maybe" })).toEqual({
        ok: false,
        message: "outcome must be one of: visited, wont_go, not_yet",
      });
      expect(parsePromptAnswerBody({ outcome: "auto" })).toEqual({
        ok: false,
        message: "outcome must be one of: visited, wont_go, not_yet",
      });
      expect(parsePromptAnswerBody({ outcome: 1 })).toEqual({
        ok: false,
        message: "outcome must be one of: visited, wont_go, not_yet",
      });
    });

    it("accepts valid outcome values", () => {
      expect(parsePromptAnswerBody({ outcome: "visited" })).toEqual({
        ok: true,
        value: { outcome: "visited" },
      });
      expect(parsePromptAnswerBody({ outcome: "wont_go" })).toEqual({
        ok: true,
        value: { outcome: "wont_go" },
      });
      expect(parsePromptAnswerBody({ outcome: "not_yet" })).toEqual({
        ok: true,
        value: { outcome: "not_yet" },
      });
    });
  });

  describe("common fail helper", () => {
    it("returns formatted error result", () => {
      expect(fail("custom error")).toEqual({
        ok: false,
        message: "custom error",
      });
    });
  });
});
