import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * BRAWUKA-724 (review findings BRAWUKA-751 / BRAWUKA-752): rollback-prod.sh must
 * pair an image with the snapshot taken at THAT deployment's boundary, select
 * the boundary of a repeated tag's newest occurrence, and actually apply — and
 * verify — the resolved image before the database is restored.
 *
 * releases.log rows are `timestamp|image tag|snapshot taken before that
 * release's migrations`, so undoing release k pairs row[k].snapshot with
 * row[k-1].tag.
 *
 * Every case runs the real script against a throwaway repo root. The docker CLI
 * and the restore.sh delegate are test doubles (fixtures, not copies of any
 * production logic): `--plan-only` exits before they are reachable, and the
 * execution cases assert the commands the script actually issues.
 */
const REPO_ROOT = path.resolve(__dirname, "../../..");
const ROLLBACK_SCRIPT = path.join(REPO_ROOT, "scripts/devops/rollback-prod.sh");

/** Records its argv, emulates a Swarm/Compose target that reports back. */
const DOCKER_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG"
# What the target reports back: an explicit fixture reference, nothing at all
# (a failed inspect), or the reference the last update/compose command applied.
report_image() {
  if [ -n "$STUB_REPORT_MISSING" ]; then
    return 0
  fi
  if [ -n "$STUB_REPORT_IMAGE" ]; then
    printf '%s\\n' "$STUB_REPORT_IMAGE"
    return 0
  fi
  cat "$STUB_STATE_DIR/$1" 2>/dev/null || true
}
case "$1" in
  info)
    printf '%s\\n' "$STUB_SWARM_STATE"
    ;;
  service)
    case "$2" in
      update)
        image=""
        previous=""
        for arg in "$@"; do
          if [ "$previous" = "--image" ]; then image="$arg"; fi
          previous="$arg"
        done
        if [ -n "$STUB_UPDATE_FAILS" ]; then
          echo "stub docker: service update failed" >&2
          exit 1
        fi
        printf '%s\\n' "$image" > "$STUB_STATE_DIR/service_image"
        ;;
      inspect)
        report_image service_image
        ;;
    esac
    ;;
  inspect)
    report_image container_image
    ;;
  compose)
    printf '%s\\n' "coffeemode-web-prod:$IMAGE_TAG" > "$STUB_STATE_DIR/container_image"
    ;;
esac
exit 0
`;

const RESTORE_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_RESTORE_LOG"
exit 0
`;

interface ReleaseRow {
  tag: string;
  /** Absolute snapshot path recorded for this release; "" means the release
   *  was recorded by `--force-skip-backup` and carries no boundary archive. */
  snapshot?: string;
}

interface RunResult {
  ok: boolean;
  output: string;
  dockerLog: string;
  restoreLog: string;
}

interface Fixture {
  script: string;
  /** Create the archive file and return its path. */
  createSnapshot: (name: string) => string;
  writeHistory: (rows: ReleaseRow[]) => void;
  run: (args: string[], env?: Record<string, string>) => RunResult;
}

const createdFixtures: string[] = [];

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "coffeemode-rollback-"));
  createdFixtures.push(root);
  const scriptDir = path.join(root, "scripts", "devops");
  const binDir = path.join(root, "bin");
  const stateDir = path.join(root, "state");
  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(path.join(root, "backups", "prod"), { recursive: true });
  mkdirSync(path.join(root, "deploy", "dokploy"), { recursive: true });
  // Production always has .env.prod; the compose branch passes it as --env-file.
  writeFileSync(path.join(root, "deploy", "dokploy", ".env.prod"), "DIRECT_URL=postgres://stub\n");
  cpSync(ROLLBACK_SCRIPT, path.join(scriptDir, "rollback-prod.sh"));

  const dockerStub = path.join(binDir, "docker");
  writeFileSync(dockerStub, DOCKER_STUB);
  chmodSync(dockerStub, 0o755);
  const restoreStub = path.join(scriptDir, "restore.sh");
  writeFileSync(restoreStub, RESTORE_STUB);
  chmodSync(restoreStub, 0o755);

  const dockerLog = path.join(root, "docker.log");
  const restoreLog = path.join(root, "restore.log");
  writeFileSync(dockerLog, "");
  writeFileSync(restoreLog, "");

  const script = path.join(scriptDir, "rollback-prod.sh");
  const childEnv = {
    ...process.env,
    // The doubles are reached by name; the real docker is not on this PATH.
    PATH: `${binDir}:/bin:/usr/bin`,
    STUB_LOG: dockerLog,
    STUB_RESTORE_LOG: restoreLog,
    STUB_STATE_DIR: stateDir,
    STUB_SWARM_STATE: "inactive",
  };

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
  const run = (args: string[], env: Record<string, string> = {}): RunResult => {
    let ok = true;
    let output = "";
    try {
      output = execFileSync("bash", [script, ...args], {
        encoding: "utf8",
        timeout: 20_000,
        env: { ...childEnv, ...env },
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      ok = false;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    return {
      ok,
      output,
      dockerLog: readFileSync(dockerLog, "utf8"),
      restoreLog: readFileSync(restoreLog, "utf8"),
    };
  };

  return { script, createSnapshot, writeHistory, run };
}

afterAll(() => {
  for (const root of createdFixtures) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface Plan extends RunResult {
  image?: string;
  snapshot?: string;
}

function plan(fixture: Fixture, args: string[]): Plan {
  const result = fixture.run(["--plan-only", ...args]);
  const image = /^\s*image_tag:\s*(\S+)\s*$/m.exec(result.output)?.[1];
  const snapshot = /^\s*snapshot:\s*(\S+)\s*$/m.exec(result.output)?.[1];
  return { ...result, image, snapshot };
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

/**
 * History from an explicit tag list, each row with its own archive
 * (`pre-<index>-<tag>.dump.gz`) so repeated tags stay distinguishable.
 */
function taggedFixture(tags: string[]): { fixture: Fixture; pre: string[] } {
  const fixture = makeFixture();
  const pre = tags.map((tag, index) => fixture.createSnapshot(`pre-${index}-${tag}.dump.gz`));
  fixture.writeHistory(tags.map((tag, index) => ({ tag, snapshot: pre[index] })));
  return { fixture, pre };
}

describe("rollback-prod.sh release-boundary resolution", () => {
  it("pairs the previous image with the boundary snapshot of the release being undone (A→B→C)", () => {
    const { fixture, preB, preC } = abcFixture();

    const result = plan(fixture, []);

    expect(result.output).toContain("Resolved rollback plan");
    expect(result.ok).toBe(true);
    expect(result.image).toBe("B");
    expect(result.snapshot).toBe(preC);
    // The regression: row B's own snapshot is data from before B, one release
    // older than image B itself.
    expect(result.snapshot).not.toBe(preB);
  });

  it("resolves a repeated tag to its newest occurrence (A,B,C,B,D + --image-tag B)", () => {
    const { fixture, pre } = taggedFixture(["A", "B", "C", "B", "D"]);

    const result = plan(fixture, ["--image-tag", "B"]);

    expect(result.ok).toBe(true);
    expect(result.image).toBe("B");
    // The newest B was live between row 3 and row 4, so undoing release D is
    // the boundary that pairs with it; pre-2-C would discard D's writes.
    expect(result.snapshot).toBe(pre[4]);
    expect(result.snapshot).not.toBe(pre[2]);
  });

  it("does not fall back to an older occurrence when the newest one has no later boundary (A,B,C,B)", () => {
    const { fixture, pre } = taggedFixture(["A", "B", "C", "B"]);

    const result = plan(fixture, ["--image-tag", "B"]);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("newest recorded release");
    expect(result.output).not.toContain("Resolved rollback plan");
    // pre-2-C is the older B boundary; silently restoring it is the defect.
    expect(result.output).not.toContain(pre[2]);
  });

  it("reaches an earlier boundary of a repeated tag through an explicit snapshot", () => {
    const { fixture, pre } = taggedFixture(["A", "B", "C", "B", "D"]);

    const result = plan(fixture, ["--backup-file", pre[2]]);

    expect(result.ok).toBe(true);
    expect(result.image).toBe("B");
    expect(result.snapshot).toBe(pre[2]);
  });

  it("refuses to invent an image when a failed deployment never reached the release-history append", () => {
    const { fixture, preC } = abcFixture();
    const preD = fixture.createSnapshot("pre-D.dump.gz"); // not in releases.log

    const unpaired = plan(fixture, ["--backup-file", preD]);
    expect(unpaired.ok).toBe(false);
    expect(unpaired.output).toContain("is not recorded in");
    expect(unpaired.output).toContain("failed before its release-history append");
    // The hint names the image the failed deployment replaced.
    expect(unpaired.output).toContain("the last recorded release is C");

    const paired = plan(fixture, ["--backup-file", preD, "--image-tag", "C"]);
    expect(paired.ok).toBe(true);
    expect(paired.image).toBe("C");
    expect(paired.snapshot).toBe(preD);
    expect(paired.snapshot).not.toBe(preC);
  });

  it("refuses to roll back the first deployment", () => {
    const fixture = makeFixture();
    const preA = fixture.createSnapshot("pre-A.dump.gz");
    fixture.writeHistory([{ tag: "A", snapshot: preA }]);

    const implicit = plan(fixture, []);
    expect(implicit.ok).toBe(false);
    expect(implicit.output).toContain("first deployment");
    expect(implicit.output).toContain("no earlier image");

    // The first deployment's own boundary has no earlier image either.
    const explicitSnapshot = plan(fixture, ["--backup-file", preA]);
    expect(explicitSnapshot.ok).toBe(false);
    expect(explicitSnapshot.output).toContain("first deployment's boundary");
  });

  it("resolves an explicit --image-tag to the snapshot recorded for the release deployed after it", () => {
    const { fixture, preB, preC } = abcFixture();

    const toB = plan(fixture, ["--image-tag", "B"]);
    expect(toB.ok).toBe(true);
    expect(toB.image).toBe("B");
    expect(toB.snapshot).toBe(preC);

    // Image C is the newest recorded release: nothing was deployed after it,
    // so no boundary snapshot can pair with it.
    const toC = plan(fixture, ["--image-tag", "C"]);
    expect(toC.ok).toBe(false);
    expect(toC.output).toContain("newest recorded release");

    const unknown = plan(fixture, ["--image-tag", "Z"]);
    expect(unknown.ok).toBe(false);
    expect(unknown.output).toContain("Image tag Z is not recorded in");
    expect(unknown.output).toContain("--backup-file");

    // A recorded-but-older boundary resolves through the explicit snapshot too.
    const toA = plan(fixture, ["--backup-file", preB]);
    expect(toA.ok).toBe(true);
    expect(toA.image).toBe("A");
    expect(toA.snapshot).toBe(preB);
  });

  it("fails when the boundary archive is unavailable instead of falling back to an older one", () => {
    const { fixture, preB, preC } = abcFixture();
    rmSync(preC); // boundary archive gone; older archives still present

    const result = plan(fixture, []);

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

    const implicit = plan(fixture, []);
    expect(implicit.ok).toBe(false);
    expect(implicit.output).toContain("has no boundary snapshot");

    const viaImage = plan(fixture, ["--image-tag", "B"]);
    expect(viaImage.ok).toBe(false);
    expect(viaImage.output).toContain("recorded no boundary snapshot");
  });

  it("fails when there is no release history", () => {
    const fixture = makeFixture();

    const result = plan(fixture, []);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("No releases recorded in");
    expect(result.output).toContain("--image-tag");
  });

  it("honours an explicitly paired --image-tag and --backup-file without deriving anything", () => {
    const { fixture } = abcFixture();
    const manual = fixture.createSnapshot("manual.dump.gz");

    const result = plan(fixture, ["--image-tag", "B", "--backup-file", manual]);

    expect(result.ok).toBe(true);
    expect(result.image).toBe("B");
    expect(result.snapshot).toBe(manual);

    const missing = plan(fixture, ["--image-tag", "B", "--backup-file", `${manual}.missing`]);
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("Boundary snapshot not found");

    // The pairing is the operator's, so it resolves even with no history to derive from.
    const noHistory = makeFixture();
    const standalone = plan(noHistory, ["--image-tag", "B", "--backup-file", manual]);
    expect(standalone.ok).toBe(true);
    expect(standalone.image).toBe("B");
    expect(standalone.snapshot).toBe(manual);
  });
});

describe("rollback-prod.sh executor — the resolved image actually runs", () => {
  it("applies and verifies an explicit older target in Swarm mode before restoring", () => {
    const { fixture, preB } = abcFixture();

    const result = fixture.run(["--yes", "--skip-smoke", "--image-tag", "A"], {
      STUB_SWARM_STATE: "active",
    });

    expect(result.ok).toBe(true);
    // The requested image is the one shipped: `docker service rollback` would
    // restore the service's own previous spec, which need not be tag A.
    expect(result.dockerLog).toContain(
      "service update --image coffeemode-web-prod:A coffeemode-prod_web-prod",
    );
    expect(result.dockerLog).not.toContain("service rollback");
    expect(result.output).toContain("Web container reverted to image: coffeemode-web-prod:A");
    expect(result.restoreLog).toContain(`--file ${preB}`);
    expect(result.restoreLog).toContain("--env prod");
  });

  it("fails closed when the Swarm service does not report the resolved image", () => {
    const { fixture } = abcFixture();

    const result = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "active",
      STUB_REPORT_IMAGE: "coffeemode-web-prod:C", // rollback semantics: not our target
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("not 'coffeemode-web-prod:B'");
    expect(result.output).toContain("Refusing to restore the database");
    expect(result.restoreLog).toBe("");
  });

  it("applies the newest boundary of a repeated tag end to end (A,B,C,B,D + --image-tag B)", () => {
    const { fixture, pre } = taggedFixture(["A", "B", "C", "B", "D"]);

    const result = fixture.run(["--yes", "--skip-smoke", "--image-tag", "B"], {
      STUB_SWARM_STATE: "active",
    });

    expect(result.ok).toBe(true);
    expect(result.dockerLog).toContain(
      "service update --image coffeemode-web-prod:B coffeemode-prod_web-prod",
    );
    // pre-2-C is the older B boundary and would discard release D's writes.
    expect(result.restoreLog).toContain(`--file ${pre[4]}`);
    expect(result.restoreLog).not.toContain(pre[2]);
  });

  it("does not restore when the container update itself fails", () => {
    const { fixture } = abcFixture();

    const result = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "active",
      STUB_UPDATE_FAILS: "1",
    });

    expect(result.ok).toBe(false);
    expect(result.restoreLog).toBe("");
  });

  it("applies and verifies the resolved image on the compose path before restoring", () => {
    const { fixture, preC } = abcFixture();

    const result = fixture.run(["--yes", "--skip-smoke"], { STUB_SWARM_STATE: "inactive" });

    expect(result.ok).toBe(true);
    expect(result.dockerLog).toContain("compose");
    expect(result.dockerLog).toContain("up -d web-prod");
    expect(result.output).toContain("Web container reverted to image: coffeemode-web-prod:B");
    expect(result.restoreLog).toContain(`--file ${preC}`);
  });

  it("fails closed on the compose path when the container reports another image", () => {
    const { fixture } = abcFixture();

    const result = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "inactive",
      STUB_REPORT_IMAGE: "coffeemode-web-prod:latest",
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Refusing to restore the database");
    expect(result.restoreLog).toBe("");
  });

  it("rejects another repository that carries the resolved tag, on both paths", () => {
    const { fixture } = abcFixture();

    const swarm = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "active",
      STUB_REPORT_IMAGE: "other-application:B",
    });
    const compose = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "inactive",
      STUB_REPORT_IMAGE: "other-application:B",
    });

    for (const result of [swarm, compose]) {
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Container reports image 'other-application:B'");
      expect(result.output).toContain("not 'coffeemode-web-prod:B'");
      expect(result.output).toContain("Refusing to restore the database");
      expect(result.restoreLog).toBe("");
    }
  });

  it("accepts the resolved image pinned to the digest its tag resolved to", () => {
    const { fixture, preB } = abcFixture();
    const digest = "9f2c".repeat(16); // 64 hex characters

    const result = fixture.run(["--yes", "--skip-smoke", "--image-tag", "A"], {
      STUB_SWARM_STATE: "active",
      STUB_REPORT_IMAGE: `coffeemode-web-prod:A@sha256:${digest}`,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain(
      `Web container reverted to image: coffeemode-web-prod:A@sha256:${digest}`,
    );
    expect(result.restoreLog).toContain(`--file ${preB}`);
  });

  it("rejects a digest suffix that is not a sha256 pin of the resolved image", () => {
    const { fixture } = abcFixture();
    const digest = "9f2c".repeat(16);

    // A truncated digest, a non-sha256 algorithm, and a foreign repository
    // pinned to its own digest all report something other than the plan.
    const reports = [
      "coffeemode-web-prod:B@sha256:9f2c",
      `coffeemode-web-prod:B@sha512:${digest}`,
      `other-application:B@sha256:${digest}`,
    ];

    for (const report of reports) {
      const result = fixture.run(["--yes", "--skip-smoke"], {
        STUB_SWARM_STATE: "active",
        STUB_REPORT_IMAGE: report,
      });

      expect(result.ok).toBe(false);
      expect(result.output).toContain(`Container reports image '${report}'`);
      expect(result.output).toContain("Refusing to restore the database");
      expect(result.restoreLog).toBe("");
    }
  });

  it("fails closed when the container reports no image at all", () => {
    const { fixture } = abcFixture();

    const swarm = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "active",
      STUB_REPORT_MISSING: "1",
    });
    const compose = fixture.run(["--yes", "--skip-smoke"], {
      STUB_SWARM_STATE: "inactive",
      STUB_REPORT_MISSING: "1",
    });

    for (const result of [swarm, compose]) {
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Container reports image '<none>'");
      expect(result.output).toContain("Refusing to restore the database");
      expect(result.restoreLog).toBe("");
    }
  });
});
