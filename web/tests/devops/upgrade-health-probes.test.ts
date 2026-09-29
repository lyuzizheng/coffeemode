import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// BRAWUKA-762: staging.cafemood.app sits behind Cloudflare Access, and the WAF
// suspicious-UA rule challenges curl's default UA on /api/* (BRAWUKA-237). The
// upgrade pipelines used to probe /api/health with neither, so the edge answered
// with the Access gate instead of health JSON and a healthy deployment was
// reported as a convergence timeout (or silently degraded to "cold start").
//
// Every case below runs the real scripts with `curl`, `docker` and `node`
// shimmed on PATH, so the assertions are about what the scripts put on the wire
// and how they exit — never about a live staging or production edge. The shims
// also let a case prove the absence of a side effect: a tokenless run must not
// reach the deploy webhook at all.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const STAGING_SCRIPT = "repo/scripts/devops/upgrade-staging.sh";
const PROD_SCRIPT = "repo/scripts/devops/upgrade-prod.sh";
const STAGING_EDGE = "https://staging.cafemood.app";
const PROD_EDGE = "https://cafemood.app";
const SMOKE_UA = "cafemood-smoke/1.0";
const ACCESS_ID = "test-client-id.access";
const ACCESS_SECRET = "test-client-secret";

// The scripts auto-discover the Service Token from the repo's own staging env
// file, and a developer machine may export the real token. Both would turn a
// tokenless contract into a token-present run, so each case runs a byte-identical
// copy of the script inside a scratch tree with an empty HOME and a cleared
// credential environment.
const CURL_STUB = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$STUB_LOG"
url="\${!#}"
code="\${STUB_HTTP_CODE:-200}"
body=""
case "$url" in
  */api/health)
    # STUB_HTTP_CODES: a per-probe status sequence — the last value repeats —
    # so a case can model the shapes this contract is about: a healthy baseline
    # followed by the Access gate (200,403), or a transient blip that clears
    # (200,503,200). "000" means curl never got a response at all.
    if [[ -n "\${STUB_HTTP_CODES:-}" ]]; then
      count=$(( $(cat "$STUB_PROBE_COUNT" 2>/dev/null || echo 0) + 1 ))
      printf '%s' "$count" > "$STUB_PROBE_COUNT"
      IFS=',' read -r -a codes <<< "\${STUB_HTTP_CODES}"
      index=$(( count - 1 ))
      [[ "$index" -ge "\${#codes[@]}" ]] && index=$(( \${#codes[@]} - 1 ))
      code="\${codes[$index]}"
    fi
    [[ "$code" == "000" ]] && exit 7
    if [[ "$code" == 2* ]]; then
      body='{"ok":true,"version":"v9.9.9-stub","boot_time":"2026-09-27T00:00:00Z"}'
    else
      # What the edge really answers when the Service Token is not accepted: an
      # Access login redirect / denial page, never health JSON.
      body='{"error":"cloudflare-access"}'
    fi
    ;;
  *) body='stub' ;;
esac
case "$*" in
  *'%{http_code}'*)
    printf '%s\\n%s' "$body" "$code"
    exit 0
    ;;
esac
# -f: fail on 4xx/5xx like the real curl, so a gated probe stays empty.
case "$code" in
  2*) printf '%s' "$body" ;;
  *) exit 22 ;;
esac
`;

const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$STUB_LOG"
exit 0
`;

const NODE_STUB = `#!/usr/bin/env bash
printf 'node %s\\n' "$*" >> "$STUB_LOG"
exit 0
`;

// The retry loops sleep 3s between polls; stubbing it keeps the cases that
// exercise the full retry budget (persistently unhealthy, or gated) instant.
const SLEEP_STUB = `#!/usr/bin/env bash
exit 0
`;

let tmpRoot = "";
let stubBin = "";
let runIndex = 0;

function scratchPath(rel: string): string {
  return path.join(tmpRoot, rel);
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-upgrade-probes-"));
  stubBin = scratchPath("bin");
  fs.mkdirSync(stubBin);
  fs.writeFileSync(path.join(stubBin, "curl"), CURL_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(stubBin, "docker"), DOCKER_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(stubBin, "node"), NODE_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(stubBin, "sleep"), SLEEP_STUB, { mode: 0o755 });
  fs.mkdirSync(scratchPath("home"));
  const devops = scratchPath("repo/scripts/devops");
  fs.mkdirSync(path.join(devops, "lib"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/devops/upgrade-staging.sh"), scratchPath(STAGING_SCRIPT));
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/devops/upgrade-prod.sh"), scratchPath(PROD_SCRIPT));
  // Both scripts resolve their connection string through the shared helper
  // (BRAWUKA-747), so the scratch checkout carries it too.
  fs.copyFileSync(
    path.join(REPO_ROOT, "scripts/devops/lib/db-url.sh"),
    path.join(devops, "lib", "db-url.sh"),
  );
  // The prod pipeline runs the migration runner from the checkout; the stub for
  // `node` only needs the file to exist.
  fs.mkdirSync(scratchPath("repo/web/scripts"), { recursive: true });
  fs.writeFileSync(scratchPath("repo/web/scripts/migrate.mjs"), "// stub\n");
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface ScriptRun {
  status: number;
  output: string;
  log: string;
}

const CLEARED_ENV: Record<string, undefined> = {
  CF_ACCESS_CLIENT_ID: undefined,
  CF_ACCESS_CLIENT_SECRET: undefined,
  STAGING_DOMAIN: undefined,
  PROD_DOMAIN: undefined,
  STAGING_DIRECT_URL: undefined,
  PROD_DIRECT_URL: undefined,
  STAGING_DATABASE_URL: undefined,
  DOKPLOY_DEPLOY_URL: undefined,
  DOKPLOY_DEPLOY_TOKEN: undefined,
  DOKPLOY_STAGING_DEPLOY_URL: undefined,
  DOKPLOY_STAGING_DEPLOY_TOKEN: undefined,
  DOKPLOY_PROD_DEPLOY_URL: undefined,
  DOKPLOY_PROD_DEPLOY_TOKEN: undefined,
  STUB_HTTP_CODE: undefined,
  STUB_HTTP_CODES: undefined,
};

function runScript(
  script: string,
  args: string[],
  overrides: Record<string, string | undefined> = {},
): ScriptRun {
  runIndex += 1;
  const logPath = scratchPath(`invocations-${runIndex}.log`);
  fs.writeFileSync(logPath, "");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries({
    ...CLEARED_ENV,
    STUB_LOG: logPath,
    STUB_PROBE_COUNT: scratchPath(`probe-count-${runIndex}`),
    ...overrides,
  })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  env.PATH = `${stubBin}:${env.PATH ?? ""}`;
  env.HOME = scratchPath("home");

  let status = 0;
  let output = "";
  try {
    output = execSync(`bash "${scratchPath(script)}" ${args.join(" ")}`, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return { status, output, log: fs.readFileSync(logPath, "utf8") };
}

const STAGING_ARGS = [
  "--skip-backup",
  "--skip-migrations",
  "--skip-smoke",
  "--image-tag",
  "v9.9.9",
];
const DEPLOY_WEBHOOK = "https://dokploy.example.test/api/deploy/staging";

function invocations(log: string, command: string): string[] {
  return log.split("\n").filter((line) => line.startsWith(`${command} `));
}

function healthProbes(log: string): string[] {
  return invocations(log, "curl").filter((line) => line.includes("/api/health"));
}

/** Every health probe in the log must carry the token pair and the smoke UA. */
function expectAuthenticatedHealthProbes(
  log: string,
  edge: string,
  id: string,
  secret: string,
): string[] {
  const probes = healthProbes(log);
  expect(probes.length).toBeGreaterThan(0);
  for (const probe of probes) {
    expect(probe).toContain(`${edge}/api/health`);
    expect(probe).toContain(`CF-Access-Client-Id: ${id}`);
    expect(probe).toContain(`CF-Access-Client-Secret: ${secret}`);
    expect(probe).toContain(`-A ${SMOKE_UA}`);
  }
  return probes;
}

/** No probe may reach for a second, unprotected entry point (BRAWUKA-761). */
function expectNoPlaintextTarget(log: string): void {
  const urls = invocations(log, "curl")
    .map((line) => line.split(" ").at(-1) ?? "")
    .filter((arg) => arg.includes("://"));
  for (const url of urls) expect(url.startsWith("https://")).toBe(true);
}

describe("upgrade-staging.sh — Cloudflare Access probes", () => {
  it("aborts before any side effect when the Service Token is missing", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK]);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("CF_ACCESS_CLIENT_ID");
    expect(run.output).toContain("CF_ACCESS_CLIENT_SECRET");
    expect(run.output).toContain("Cloudflare Access");
    // No probe, no webhook, no compose call: the run never touched the edge,
    // and the abort landed before the pipeline's first step.
    expect(run.log.trim()).toBe("");
    expect(run.output).not.toContain("Step 1/5");
  });

  it("aborts on a half-configured token pair", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK], {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("CF_ACCESS_CLIENT_SECRET");
    expect(run.log.trim()).toBe("");
  });

  it("authenticates the baseline and the webhook convergence probes", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK], {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
    });

    expect(run.status).toBe(0);
    const probes = expectAuthenticatedHealthProbes(run.log, STAGING_EDGE, ACCESS_ID, ACCESS_SECRET);
    // Pre-deployment baseline plus at least one convergence poll.
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expectNoPlaintextTarget(run.log);
    const deploys = invocations(run.log, "curl").filter((line) => line.includes(DEPLOY_WEBHOOK));
    expect(deploys).toHaveLength(1);
    // The Service Token is scoped to the staging edge; the Dokploy webhook is a
    // different origin and must never receive it.
    expect(deploys[0]).not.toContain(ACCESS_SECRET);
    expect(run.output).toContain("convergence verified");
    // The token travels in the request headers, never in the run's output.
    expect(run.output).not.toContain(ACCESS_SECRET);
  });

  it("authenticates the compose-path convergence probes", () => {
    const run = runScript(STAGING_SCRIPT, STAGING_ARGS, {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
    });

    expect(run.status).toBe(0);
    expectAuthenticatedHealthProbes(run.log, STAGING_EDGE, ACCESS_ID, ACCESS_SECRET);
    expectNoPlaintextTarget(run.log);
    // The compose path still deploys and still waits for convergence.
    expect(run.log).toContain("docker compose");
    expect(run.log).toContain("up -d web-staging");
    expect(run.output).toContain("Staging healthcheck is green");
  });

  it("discovers the Service Token from deploy/dokploy/.env.staging", () => {
    const envFile = scratchPath("repo/deploy/dokploy/.env.staging");
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, `CF_ACCESS_CLIENT_ID=file-client-id.access\nCF_ACCESS_CLIENT_SECRET=file-client-secret\n`);
    try {
      const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK]);

      expect(run.status).toBe(0);
      expectAuthenticatedHealthProbes(run.log, STAGING_EDGE, "file-client-id.access", "file-client-secret");
    } finally {
      fs.rmSync(envFile, { force: true });
    }
  });

  it("fails by name when the edge answers the Access gate on the baseline probe", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK], {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
      STUB_HTTP_CODE: "403",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("403");
    expect(run.output).toContain("CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET");
    // A rejected probe must not be followed by a deployment.
    expect(run.log).not.toContain(DEPLOY_WEBHOOK);
  });

  // The token can stop being accepted *after* the baseline passed (expiry, a
  // policy edit), so both post-deployment polling paths must classify the
  // status themselves — a status-blind poll reports that as a build timeout.
  const DEPLOYMENT_PATHS = [
    {
      name: "webhook",
      args: [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK],
      phase: "webhook convergence poll",
    },
    { name: "compose", args: STAGING_ARGS, phase: "compose convergence poll" },
  ];
  const GATE_CODES = ["302", "401", "403"];

  for (const path of DEPLOYMENT_PATHS) {
    for (const code of GATE_CODES) {
      it(`fails on the first denied poll with HTTP ${code} on the ${path.name} path`, () => {
        const run = runScript(STAGING_SCRIPT, path.args, {
          CF_ACCESS_CLIENT_ID: ACCESS_ID,
          CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
          // Healthy baseline, then the gate.
          STUB_HTTP_CODES: `200,${code}`,
        });

        expect(run.status).not.toBe(0);
        expect(run.output).toContain(`HTTP ${code}`);
        expect(run.output).toContain(`[${path.phase}]`);
        // It names the credentials to check — and never prints their values.
        expect(run.output).toContain("CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET");
        expect(run.output).not.toContain(ACCESS_ID);
        expect(run.output).not.toContain(ACCESS_SECRET);
        // Baseline plus the single denied poll: it stops there instead of
        // burning the retry budget on a verdict that will not change.
        expect(healthProbes(run.log)).toHaveLength(2);
        expect(run.output).not.toContain("Timed out waiting for");
      });
    }
  }

  it("keeps polling through a transient 5xx and still converges (webhook path)", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK], {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
      STUB_HTTP_CODES: "200,503,503,200",
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain("convergence verified");
    expect(healthProbes(run.log)).toHaveLength(4);
  });

  it("keeps polling through a transport failure and still converges (compose path)", () => {
    const run = runScript(STAGING_SCRIPT, STAGING_ARGS, {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
      // "000": curl got no response at all — transient, and never the gate.
      STUB_HTTP_CODES: "200,000,200",
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Staging healthcheck is green");
    expect(healthProbes(run.log)).toHaveLength(3);
  });

  it("still times out on a persistent 5xx, naming the last status", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--deploy-url", DEPLOY_WEBHOOK], {
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
      STUB_HTTP_CODES: "200,503",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Timed out waiting for staging release to converge");
    expect(run.output).toContain("HTTP 503");
    expect(run.output).not.toContain("Access gate");
    // A transient error keeps the full retry budget: baseline + 60 polls.
    expect(healthProbes(run.log)).toHaveLength(61);
  });

  it("keeps --dry-run free of credentials and of edge traffic", () => {
    const run = runScript(STAGING_SCRIPT, [...STAGING_ARGS, "--dry-run"]);

    expect(run.status).toBe(0);
    expect(run.log.trim()).toBe("");
    expect(run.output).toContain("DRY-RUN");
  });
});

describe("upgrade-prod.sh — probe identity (sibling sweep)", () => {
  it("identifies every production health probe as the whitelisted smoke UA", () => {
    const run = runScript(
      PROD_SCRIPT,
      [
        "--skip-staging-gate",
        "--force-skip-backup",
        "--skip-smoke",
        "--image-tag",
        "v9.9.9",
        "--deploy-url",
        "https://dokploy.example.test/api/deploy/prod",
      ],
      { PROD_DIRECT_URL: "postgresql://stub:stub@127.0.0.1:5432/stub" },
    );

    expect(run.status).toBe(0);
    const probes = invocations(run.log, "curl").filter((line) => line.includes("/api/health"));
    expect(probes.length).toBeGreaterThanOrEqual(2);
    for (const probe of probes) {
      expect(probe).toContain(`${PROD_EDGE}/api/health`);
      expect(probe).toContain(`-A ${SMOKE_UA}`);
    }
    expectNoPlaintextTarget(run.log);
  });
});
