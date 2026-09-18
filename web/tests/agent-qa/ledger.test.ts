import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendLedgerEntry,
  readLedger,
  validateLedgerEntry,
} from "../../../scripts/agent-qa/ledger.mjs";

const RUN_ID = "run-1";
let scratchDir = "";

afterEach(() => {
  if (scratchDir) rmSync(scratchDir, { force: true, recursive: true });
  scratchDir = "";
});

function tempFile(name: string): string {
  scratchDir = mkdtempSync(join(tmpdir(), "agent-qa-ledger-"));
  return join(scratchDir, name);
}

describe("validateLedgerEntry", () => {
  it("accepts a cafe entry and stamps createdAt", () => {
    const stored = validateLedgerEntry({ runId: RUN_ID, kind: "cafe", id: "cafe-1" });
    expect(stored.runId).toBe(RUN_ID);
    expect(stored.kind).toBe("cafe");
    expect(Number.isNaN(Date.parse(stored.createdAt))).toBe(false);
  });

  it("rejects unknown kinds and empty ids", () => {
    expect(() => validateLedgerEntry({ runId: RUN_ID, kind: "user", id: "u-1" })).toThrow(
      /unknown kind/,
    );
    expect(() => validateLedgerEntry({ runId: RUN_ID, kind: "cafe", id: "" })).toThrow(
      /non-empty id/,
    );
  });
});

describe("appendLedgerEntry / readLedger", () => {
  it("round-trips entries in append order", () => {
    const file = tempFile("run.jsonl");
    appendLedgerEntry(file, { runId: RUN_ID, kind: "cafe", id: "cafe-1" });
    appendLedgerEntry(file, { runId: RUN_ID, kind: "checkin", id: "checkin-1" });
    expect(readLedger(file).map((entry) => entry.id)).toEqual(["cafe-1", "checkin-1"]);
  });

  it("reads a missing ledger as empty", () => {
    expect(readLedger(tempFile("nothing.jsonl"))).toEqual([]);
  });

  it("fails loud on a corrupt line, naming it", () => {
    const file = tempFile("run.jsonl");
    appendLedgerEntry(file, { runId: RUN_ID, kind: "cafe", id: "cafe-1" });
    appendFileSync(file, "this is not json\n", "utf8");
    expect(() => readLedger(file)).toThrow(/line 2/);
  });

  it("fails loud on a schema-violating line, naming it", () => {
    const file = tempFile("run.jsonl");
    appendFileSync(file, `${JSON.stringify({ runId: RUN_ID, kind: "user", id: "u-1" })}\n`, "utf8");
    expect(() => readLedger(file)).toThrow(/line 1/);
  });
});
