import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * BRAWUKA-724: rollback-prod.sh must pair an image with the snapshot taken at
 * THAT deployment's boundary, not with the snapshot of the release the image
 * belongs to.
 *
 * releases.log rows are `timestamp|image tag|snapshot taken before that
 * release's migrations`, so undoing release k pairs row[k].snapshot with
 * row[k-1].tag. Every case below runs the real script (`--plan-only` resolves
 * the plan and exits before any docker/restore step) against a throwaway repo
 * root, so the fixture supplies releases.log without touching this checkout.
 */
const REPO_ROOT = path.resolve(__dirname, "../../..");
const ROLLBACK_SCRIPT = path.join(REPO_ROOT, "scripts/devops/rollback-prod.sh");

interface ReleaseRow {
  tag: string;
  /** Absolute snapshot path recorded for this release; "" means the release
   *  was recorded by `--force-skip-backup` and carries no boundary archive. */
  snapshot?: string;
}

interface Fixture {
  script: string;
  /** Create the archive file and return its path. */
  createSnapshot: (name: string) => string;
  writeHistory: (rows: ReleaseRow[]) => void;
}

interface Plan {
  ok: boolean;
  image?: string;
  snapshot?: string;
  output: string;
}

const createdFixtures: string[] = [];

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "coffeemode-rollback-"));
  createdFixtures.push(root);
  mkdirSync(path.join(root, "scripts", "devops"), { recursive: true });
  mkdirSync(path.join(root, "backups", "prod"), { recursive: true });
  cpSync(ROLLBACK_SCRIPT, path.join(root, "scripts", "devops", "rollback-prod.sh"));
  const script = path.join(root, "scripts", "devops", "rollback-prod.sh");
  const snapshotPath = (name: string): string => path.join(root, "backups", "prod", name);
  const createSnapshot = (name: string): string => {
    const file = snapshotPath(name);
    writeFileSync(file, `fixture archive ${name}\n`);
    return file;
  };
  const writeHistory = (rows: ReleaseRow[]): void => {
    const body = rows
      .map((row, index) => {
        const timestamp = `20260924_1000${String(index).padStart(2, "0")}Z`;
        return `${timestamp}|${row.tag}|${row.snapshot ?? ""}`;
      })
      .join("\n");
    writeFileSync(path.join(root, "backups", "prod", "releases.log"), `${body}\n`);
  };
  return { script, createSnapshot, writeHistory };
}

afterAll(() => {
  for (const root of createdFixtures) {
    rmSync(root, { recursive: true, force: true });
  }
});

function plan(script: string, args: string[]): Plan {
  try {
    const stdout = execFileSync("bash", [script, "--plan-only", ...args], {
      encoding: "utf8",
      timeout: 20_000,
    });
    const image = /^\s*image_tag:\s*(\S+)\s*$/m.exec(stdout)?.[1];
    const snapshot = /^\s*snapshot:\s*(\S+)\s*$/m.exec(stdout)?.[1];
    return { ok: true, image, snapshot, output: stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Releases A -> B -> C, each with its own pre-migration archive on disk. */
function abcFixture(): { fixture: Fixture; preA: string; preB: string; preC: string } {
  const fixture = makeFixture();
  const preA = fixture.createSnapshot("pre-A.dump.gz");
  const preB = fixture.createSnapshot("pre-B.dump.gz");
  const preC = fixture.createSnapshot("pre-C.dump.gz");
  fixture.writeHistory([
    { tag: "A", snapshot: preA },
    { tag: "B", snapshot: preB },
    { tag: "C", snapshot: preC },
  ]);
  return { fixture, preA, preB, preC };
}

describe("rollback-prod.sh release-boundary resolution", () => {
  it("pairs the previous image with the boundary snapshot of the release being undone (A→B→C)", () => {
    const { fixture, preB, preC } = abcFixture();

    const result = plan(fixture.script, []);

    expect(result.output).toContain("Resolved rollback plan");
    expect(result.ok).toBe(true);
    expect(result.image).toBe("B");
    expect(result.snapshot).toBe(preC);
    // The regression: row B's own snapshot is data from before B, one release
    // older than image B itself.
    expect(result.snapshot).not.toBe(preB);
  });

  it("refuses to invent an image when a failed deployment never reached the release-history append", () => {
    const { fixture, preC } = abcFixture();
    const preD = fixture.createSnapshot("pre-D.dump.gz"); // not in releases.log

    const unpaired = plan(fixture.script, ["--backup-file", preD]);
    expect(unpaired.ok).toBe(false);
    expect(unpaired.output).toContain("is not recorded in");
    expect(unpaired.output).toContain("failed before its release-history append");
    // The hint names the image the failed deployment replaced.
    expect(unpaired.output).toContain("the last recorded release is C");

    const paired = plan(fixture.script, ["--backup-file", preD, "--image-tag", "C"]);
    expect(paired.ok).toBe(true);
    expect(paired.image).toBe("C");
    expect(paired.snapshot).toBe(preD);
    expect(paired.snapshot).not.toBe(preC);
  });

  it("refuses to roll back the first deployment", () => {
    const fixture = makeFixture();
    const preA = fixture.createSnapshot("pre-A.dump.gz");
    fixture.writeHistory([{ tag: "A", snapshot: preA }]);

    const implicit = plan(fixture.script, []);
    expect(implicit.ok).toBe(false);
    expect(implicit.output).toContain("first deployment");
    expect(implicit.output).toContain("no earlier image");

    // The first deployment's own boundary has no earlier image either.
    const explicitSnapshot = plan(fixture.script, ["--backup-file", preA]);
    expect(explicitSnapshot.ok).toBe(false);
    expect(explicitSnapshot.output).toContain("first deployment's boundary");
  });

  it("resolves an explicit --image-tag to the snapshot recorded for the release deployed after it", () => {
    const { fixture, preB, preC } = abcFixture();

    const toB = plan(fixture.script, ["--image-tag", "B"]);
    expect(toB.ok).toBe(true);
    expect(toB.image).toBe("B");
    expect(toB.snapshot).toBe(preC);

    // Image C is the newest recorded release: nothing was deployed after it,
    // so no boundary snapshot can pair with it.
    const toC = plan(fixture.script, ["--image-tag", "C"]);
    expect(toC.ok).toBe(false);
    expect(toC.output).toContain("No release is recorded after image C");

    const unknown = plan(fixture.script, ["--image-tag", "Z"]);
    expect(unknown.ok).toBe(false);
    expect(unknown.output).toContain("Image tag Z is not recorded in");
    expect(unknown.output).toContain("--backup-file");

    // A recorded-but-older boundary resolves through the explicit snapshot too.
    const toA = plan(fixture.script, ["--backup-file", preB]);
    expect(toA.ok).toBe(true);
    expect(toA.image).toBe("A");
    expect(toA.snapshot).toBe(preB);
  });

  it("fails when the boundary archive is unavailable instead of falling back to an older one", () => {
    const { fixture, preB, preC } = abcFixture();
    rmSync(preC); // boundary archive gone; older archives still present

    const result = plan(fixture.script, []);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Boundary snapshot not found");
    expect(result.output).toContain("Refusing to fall back to an older archive");
    expect(result.output).toContain(preC);
    expect(result.output).not.toContain(preB);
    expect(result.output).not.toContain("Resolved rollback plan");
  });

  it("fails when a release was recorded without a boundary snapshot", () => {
    const fixture = makeFixture();
    const preA = fixture.createSnapshot("pre-A.dump.gz");
    const preB = fixture.createSnapshot("pre-B.dump.gz");
    fixture.writeHistory([
      { tag: "A", snapshot: preA },
      { tag: "B", snapshot: preB },
      { tag: "C", snapshot: "" }, // --force-skip-backup
    ]);

    const implicit = plan(fixture.script, []);
    expect(implicit.ok).toBe(false);
    expect(implicit.output).toContain("has no boundary snapshot");

    const viaImage = plan(fixture.script, ["--image-tag", "B"]);
    expect(viaImage.ok).toBe(false);
    expect(viaImage.output).toContain("recorded no boundary snapshot");
  });

  it("fails when there is no release history", () => {
    const fixture = makeFixture();

    const result = plan(fixture.script, []);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("No releases recorded in");
    expect(result.output).toContain("--image-tag");
  });

  it("honours an explicitly paired --image-tag and --backup-file without deriving anything", () => {
    const { fixture } = abcFixture();
    const manual = fixture.createSnapshot("manual.dump.gz");

    const result = plan(fixture.script, ["--image-tag", "B", "--backup-file", manual]);

    expect(result.ok).toBe(true);
    expect(result.image).toBe("B");
    expect(result.snapshot).toBe(manual);

    const missing = plan(fixture.script, ["--image-tag", "B", "--backup-file", `${manual}.missing`]);
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("Boundary snapshot not found");

    // The pairing is the operator's, so it resolves even with no history to derive from.
    const noHistory = makeFixture();
    const standalone = plan(noHistory.script, ["--image-tag", "B", "--backup-file", manual]);
    expect(standalone.ok).toBe(true);
    expect(standalone.image).toBe("B");
    expect(standalone.snapshot).toBe(manual);
  });
});
