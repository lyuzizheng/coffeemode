import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// BRAWUKA-761: a staging smoke run without a Cloudflare Access Service Token
// used to fall back to the direct Dokploy domain (Option C, BRAWUKA-499). That
// hostname answered plain `http://` and sat outside the Access policy that
// gates `staging.cafemood.app`, so the "unauthenticated runner" path was an
// unauthenticated bypass of the gate. The fallback is deleted: a tokenless
// runner targeting the staging edge must abort with a named reason instead of
// silently probing a different, unprotected entry point.
//
// Every case below runs the real script with `curl` shimmed on PATH, so the
// assertions are about the script's own target selection and exit status —
// never about a live staging edge.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SMOKE = path.join(REPO_ROOT, "scripts/devops/smoke-test.sh");
// The retired fallback target. No run, in any mode, may request it.
const RETIRED_PLAINTEXT_HOST = "staging.n150.brabalawuka.cc";
const STAGING_EDGE = "https://staging.cafemood.app";

// Careful: the script auto-discovers a Service Token from repo-root files
// (`deploy/dokploy/.env.staging`, `web/.env.local`, `.env`) and from
// `$HOME/.config/zsh/secrets.zsh`. Both would turn a tokenless contract into a
// token-present run on a developer machine, so every case runs a byte-identical
// copy of the script inside a scratch repo tree with an empty HOME.
const SCRATCH_SCRIPT = "repo/scripts/devops/smoke-test.sh";

// Healthy canned responses for all 11 contracts, so a run that correctly
// reaches the contract stage finishes green and its exit status isolates the
// gate decision under test. `%{http_code}` asks the stub for a status only;
// `-I` (the security-header probe) asks for headers only; the last argument is
// always the URL the script targeted.
const CURL_STUB = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$STUB_LOG"
args="$*"
code="\${STUB_HTTP_CODE:-200}"
case "$args" in
  *"%{http_code}"*) printf '%s' "$code"; exit 0 ;;
esac
if [[ "$args" == *" -I "* ]]; then
  printf 'HTTP/2 %s\\n' "$code"
  printf 'x-content-type-options: nosniff\\n'
  exit 0
fi
url="\${!#}"
case "$url" in
  */api/health) printf '{"ok":true,"version":"stub"}' ;;
  */api/heartbeat) printf '{"db":"up"}' ;;
  */api/config) printf '{"banners":[]}' ;;
  */api/places/search*) printf '{"results":[]}' ;;
  */api/images/upload) printf '{"error":"unauthenticated"}' ;;
  */api/cafes/?*) printf '{"id":"stub","name":"Stub Cafe"}' ;;
  */api/cafes?*) printf '{"cafes":[{"id":"11111111-1111-1111-1111-111111111111"}]}' ;;
  */_next/static/*) printf 'console.log("stub");\\n' ;;
  */) printf '<html><title>CafeMood</title><script src="/_next/static/chunks/main-stub.js"></script></html>' ;;
  *) printf 'stub\\n' ;;
esac
`;

let tmpRoot = "";
let stubBin = "";
let runIndex = 0;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-smoke-target-"));
  stubBin = path.join(tmpRoot, "bin");
  fs.mkdirSync(stubBin);
  fs.writeFileSync(path.join(stubBin, "curl"), CURL_STUB, { mode: 0o755 });
  fs.mkdirSync(path.join(tmpRoot, "home"));
  const script = path.join(tmpRoot, SCRATCH_SCRIPT);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(SMOKE, script);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface SmokeRun {
  status: number;
  output: string;
  invocations: string;
}

const CLEARED_ENV: Record<string, undefined> = {
  CF_ACCESS_CLIENT_ID: undefined,
  CF_ACCESS_CLIENT_SECRET: undefined,
  STAGING_DOMAIN: undefined,
  PROD_DOMAIN: undefined,
  STAGING_DIRECT_DOMAIN: undefined,
  STAGING_IMAGE_DOMAIN: undefined,
  PROD_IMAGE_DOMAIN: undefined,
  STUB_HTTP_CODE: undefined,
};

function runSmoke(
  args: string[],
  overrides: Record<string, string | undefined> = {},
): SmokeRun {
  runIndex += 1;
  const logPath = path.join(tmpRoot, `invocations-${runIndex}.log`);
  fs.writeFileSync(logPath, "");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries({
    ...CLEARED_ENV,
    STUB_LOG: logPath,
    ...overrides,
  })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  env.PATH = `${stubBin}:${env.PATH ?? ""}`;
  env.HOME = path.join(tmpRoot, "home");

  let status = 0;
  let output = "";
  try {
    output = execSync(`bash "${path.join(tmpRoot, SCRATCH_SCRIPT)}" ${args.join(" ")}`, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? -1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  return { status, output, invocations: fs.readFileSync(logPath, "utf8") };
}

describe("Staging smoke target selection (BRAWUKA-761)", () => {
  it("aborts a tokenless staging run instead of reaching the retired plaintext host", () => {
    // The retired fallback's own env knob is set to the plaintext host: the
    // script must not honor it in any form.
    const run = runSmoke(["staging"], {
      STAGING_DIRECT_DOMAIN: `http://${RETIRED_PLAINTEXT_HOST}`,
      STUB_HTTP_CODE: "302",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("[FATAL]");
    expect(run.output).not.toContain(RETIRED_PLAINTEXT_HOST);
    expect(run.invocations).not.toContain(RETIRED_PLAINTEXT_HOST);
    // The verdict is not a contract failure dressed up as one: nothing ran.
    expect(run.output).not.toContain("[TEST 1]");
  });

  it("aborts a tokenless staging run whatever the edge answers", () => {
    // An unauthenticated runner must not probe the gated edge in the first
    // place — an answer of 200 says the gate is missing, not that the probe is
    // legitimate.
    const run = runSmoke(["staging"], { STUB_HTTP_CODE: "200" });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("[FATAL]");
  });

  it("aborts on a half-configured Service Token and names both variables", () => {
    const run = runSmoke(["staging"], { CF_ACCESS_CLIENT_ID: "stub-id.access" });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("[FATAL]");
    expect(run.output).toContain("CF_ACCESS_CLIENT_ID");
    expect(run.output).toContain("CF_ACCESS_CLIENT_SECRET");
  });

  it("names the explicit --url override as the way to probe an ungated target", () => {
    const run = runSmoke(["staging"]);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("--url");
  });

  it("runs every contract against the gated edge when a Service Token is configured", () => {
    const run = runSmoke(["staging"], {
      CF_ACCESS_CLIENT_ID: "stub-id.access",
      CF_ACCESS_CLIENT_SECRET: "stub-secret",
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Service Token configured");
    expect(run.invocations).toContain(`${STAGING_EDGE}/api/health`);
    expect(run.invocations).toContain("CF-Access-Client-Id: stub-id.access");
    expect(run.invocations).not.toContain(RETIRED_PLAINTEXT_HOST);
  });

  it("keeps an explicit --url override usable without a Service Token", () => {
    const run = runSmoke(["staging", "--url", "http://127.0.0.1:3111"]);

    expect(run.status).toBe(0);
    expect(run.invocations).toContain("http://127.0.0.1:3111/api/health");
  });

  it("leaves the public production target unguarded", () => {
    const run = runSmoke(["prod"]);

    expect(run.status).toBe(0);
    expect(run.invocations).toContain("https://cafemood.app/api/health");
  });
});
