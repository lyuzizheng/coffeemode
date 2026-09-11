import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const webRoot = resolve(process.cwd());
const checkFileSizeScript = join(webRoot, "scripts", "check-file-size.mjs");
const structureConfig = join(webRoot, "structure.config.mjs");

function runCheck(scriptPath: string, cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function createSourceFile(dir: string, relPath: string, lineCount: number): void {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  const lines = Array.from({ length: lineCount }, (_, i) => `export const x${i} = ${i};`);
  writeFileSync(fullPath, `${lines.join("\n")}\n`, "utf8");
}

function writeBaseline(
  dir: string,
  files: Array<{ path: string; lines: number; owner?: string; reason?: string; reviewBy?: string }>,
): void {
  const content = {
    files: files.map((f) => ({
      path: f.path,
      lines: f.lines,
      owner: f.owner ?? "BRAWUKA-175",
      reason: f.reason ?? "test baseline exemption",
      reviewBy: f.reviewBy ?? "2099-12-31",
    })),
  };
  writeFileSync(join(dir, "structure-baseline.json"), JSON.stringify(content, null, 2), "utf8");
}

describe("file-size ratchet & graduation guard (spec 0009 §7, BRAWUKA-179)", () => {
  let tempDir: string;
  let tempScript: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "file-size-ratchet-"));
    mkdirSync(join(tempDir, "scripts"), { recursive: true });
    cpSync(structureConfig, join(tempDir, "structure.config.mjs"));
    tempScript = join(tempDir, "scripts", "check-file-size.mjs");
    cpSync(checkFileSizeScript, tempScript);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes when grandfathered file lines match recorded baseline exactly", () => {
    createSourceFile(tempDir, "components/widget.tsx", 450);
    writeBaseline(tempDir, [{ path: "components/widget.tsx", lines: 450 }]);

    const result = runCheck(tempScript, tempDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("grandfathered 450/450 lines");
    expect(result.stdout).toContain("file budget check passed.");
  });

  it("R1 regression: fails when a graduated file (<= 400 lines) retains a baseline exemption", () => {
    // A file that was once over budget has shrunk to 296 lines (within 400-line budget),
    // but its grandfathered exemption (e.g. 730 lines) was not removed from the baseline.
    createSourceFile(tempDir, "lib/db/identity.ts", 296);
    writeBaseline(tempDir, [{ path: "lib/db/identity.ts", lines: 730 }]);

    const result = runCheck(tempScript, tempDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL: lib/db/identity.ts: 296 lines is now within the 400-line budget — delete the baseline exemption (spec 0009 §7.4: graduated files must not retain exemptions and let the ratchet take over)",
    );
  });

  it("R1 regression: once graduated and exemption removed, file cannot jump back to old ceiling", () => {
    // The exemption was deleted upon graduation. If a commit attempts to grow the file back
    // to the old upper limit (730 lines), it must be rejected by the hard budget guard.
    createSourceFile(tempDir, "lib/db/identity.ts", 730);
    writeBaseline(tempDir, []); // No exemption in baseline

    const result = runCheck(tempScript, tempDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL: lib/db/identity.ts: 730 lines exceeds the hard budget of 400 — split it in this change, or register a reviewed baseline exemption",
    );
  });

  it("fails when a grandfathered file grows past its recorded count (only-down ratchet)", () => {
    createSourceFile(tempDir, "components/widget.tsx", 451);
    writeBaseline(tempDir, [{ path: "components/widget.tsx", lines: 450 }]);

    const result = runCheck(tempScript, tempDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL: components/widget.tsx: 451 lines, grandfathered at 450 — exemptions may only shrink (split the file instead of growing it)",
    );
  });

  it("fails when registry is stale (file shrank > 400 lines but baseline not updated)", () => {
    createSourceFile(tempDir, "components/widget.tsx", 420);
    writeBaseline(tempDir, [{ path: "components/widget.tsx", lines: 450 }]);

    const result = runCheck(tempScript, tempDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL: components/widget.tsx: 420 lines, grandfathered at 450 — the registry is stale, so the old ceiling is still in force: lower `lines` to 420 in structure-baseline.json",
    );
  });

  it("fails when baseline exemption points to a non-existent file", () => {
    writeBaseline(tempDir, [{ path: "components/deleted.tsx", lines: 500 }]);

    const result = runCheck(tempScript, tempDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL: components/deleted.tsx: baseline exemption points at a missing file — delete the exemption",
    );
  });

  it("real workspace structure-baseline.json passes file-size check with zero errors", () => {
    const result = runCheck(checkFileSizeScript, webRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("file budget check passed.");
  });
});
