import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RULES,
  STAGING_HOST,
  isRulesFile,
  mutatedPayload,
  run,
  scratch,
  setupScratchTree,
  teardownScratchTree,
} from "./lib/cache-rules-fixture";

beforeAll(setupScratchTree);
afterAll(teardownScratchTree);

describe("apply-cache-rules.sh", () => {
  it("prints the request-phase payload without touching the network", () => {
    const { stdout } = run(["--dry-run", "--phase", "request"]);
    expect(stdout).toContain(
      "/rulesets/phases/http_request_cache_settings/entrypoint",
    );
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe("");
  });

  it("prints the request phase the checker evaluates", () => {
    const { status, stdout } = run(["--dry-run", "--phase", "request"]);
    expect(status).toBe(0);
    const payload: unknown = JSON.parse(stdout.slice(stdout.indexOf("{")));
    const file: unknown = JSON.parse(fs.readFileSync(path.join(scratch.root, RULES), "utf8"));
    if (!isRulesFile(file)) {
      throw new Error("committed payload is not a rules file");
    }
    expect(payload).toEqual(file.request);
  });

  it("PUTs the file's rules to the phase entrypoint and reports the version", () => {
    const { status, stdout } = run(["--apply", "--phase", "request"], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).toBe(0);
    expect(stdout).toContain("ok: request ruleset applied (version 7, 4 rules)");

    const log = fs.readFileSync(scratch.curlLog, "utf8");
    expect(log).toContain(
      "https://api.cloudflare.com/client/v4/zones/test-zone/rulesets/phases/http_request_cache_settings/entrypoint",
    );
    expect(log).toContain(STAGING_HOST);
  });

  it("fails closed when the credentials are missing", () => {
    const { status, stderr } = run(["--apply", "--phase", "request"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("surfaces a Cloudflare rejection instead of reporting success", () => {
    const rejection = path.join(scratch.root, "rejection.json");
    fs.writeFileSync(
      rejection,
      JSON.stringify({ success: false, errors: [{ message: "cache key not allowed" }] }),
    );
    const { status, stderr } = run(["--apply", "--phase", "request"], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
      CURL_STUB_RESPONSE_FILE: rejection,
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("cache key not allowed");
  });

  it("refuses to apply a payload that fails the policy check", () => {
    const target = path.join(scratch.root, RULES);
    const original = fs.readFileSync(target, "utf8");
    try {
      // The pre-fix shape: the unconditional /cafes/* bypass last, so
      // last-match-wins disables caching for every request.
      const payload: unknown = JSON.parse(original);
      if (!isRulesFile(payload)) throw new Error("committed payload is not a rules file");
      const rules = payload.request.rules;
      rules.push(rules.shift() as unknown);
      fs.writeFileSync(target, JSON.stringify(payload, null, 2));

      const before = fs.readFileSync(scratch.curlLog, "utf8");
      const { status, stderr } = run(["--apply", "--phase", "request"], {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ZONE_ID: "test-zone",
      });
      expect(status).not.toBe(0);
      expect(stderr).toContain("does not satisfy the cache policy contract");
      expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
    } finally {
      fs.writeFileSync(target, original);
    }
  });

  it("rejects a payload that drops a phase the contract requires", () => {
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      delete payload.response;
    });
    const { status, stderr } = run(["--apply", "--phase", "response", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("no response-phase rule pins Set-Cookie responses no-store");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects a broken payload supplied through --file", () => {
    // The default-payload case above cannot catch a checker that validates a
    // different file than the one --file selects (BRAWUKA-837), so this
    // supplies the broken policy through --file and proves no PUT happens.
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      const rules = payload.request.rules;
      rules.push(rules.shift() as unknown);
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("does not satisfy the cache policy contract");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects a later allow rule that re-opens a declared signal (BRAWUKA-836)", () => {
    // The reviewer's fault: the first eligible rule is correct, but a later
    // cache:true rule for zh-TW wins under last-match-wins and re-opens the
    // cross-locale leak. The applier must refuse it before any PUT.
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      payload.request.rules.push({
        description: "Review fault: later zh-TW cache allow",
        enabled: true,
        expression:
          'starts_with(http.request.uri.path, "/cafes/") and (any(http.request.headers["accept-language"][*] wildcard "*zh-TW*"))',
        action: "set_cache_settings",
        action_parameters: { cache: true },
      });
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("does not satisfy the cache policy contract");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects a later allow rule that overrides the origin TTL (BRAWUKA-836)", () => {
    // The reviewer's second fault: an appended en-US rule whose own
    // edge_ttl.mode is override_origin wins for en-US requests even though the
    // first eligible rule respects the origin.
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      payload.request.rules.push({
        description: "Review fault: later en-US TTL override",
        enabled: true,
        expression:
          'starts_with(http.request.uri.path, "/cafes/") and (any(http.request.headers["accept-language"][*] wildcard "*en-US*"))',
        action: "set_cache_settings",
        action_parameters: {
          cache: true,
          edge_ttl: { mode: "override_origin", default: 86400 },
        },
      });
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("does not satisfy the cache policy contract");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects a double-negated locale exclusion with zero PUTs (BRAWUKA-836)", () => {
    // The reviewer's r4 fault: `not (not (…))` reads as the exclusion but
    // asserts the opposite, so a locale=zh request would be cached. The
    // applier must refuse it before any PUT.
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      const eligible = payload.request.rules.at(-1) as { expression: string };
      payload.request.rules.push({
        ...(eligible as Record<string, unknown>),
        description: "Review fault: double-negated locale exclusion",
        expression:
          eligible.expression.replace(
            'not (http.cookie contains "locale=")',
            'not (not (http.cookie contains "locale="))',
          ) + ' and any(http.request.headers["accept-language"][*] wildcard "*en-US*")',
      } as never);
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("does not satisfy the cache policy contract");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects an alternate or branch with zero PUTs (BRAWUKA-836)", () => {
    // The reviewer's r4 fault: the `or` branch carries the exclusion text but
    // matches en-US requests without it, so a session cookie would be cached.
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      const eligible = payload.request.rules.at(-1) as { expression: string };
      payload.request.rules.push({
        ...(eligible as Record<string, unknown>),
        description: "Review fault: alternate branch overrides auth",
        expression: `(${eligible.expression}) or (starts_with(http.request.uri.path, "/cafes/") and any(http.request.headers["accept-language"][*] wildcard "*en-US*"))`,
      } as never);
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("does not satisfy the cache policy contract");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects a partial-value cookie exclusion with zero PUTs (BRAWUKA-841)", () => {
    // The reviewer's r5 fault: `locale=fr` reads as the locale exclusion but
    // leaves locale=zh cacheable. The applier must refuse it before any PUT.
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      const eligible = payload.request.rules.at(-1) as { expression: string };
      payload.request.rules.push({
        ...(eligible as Record<string, unknown>),
        description: "Review fault: partial-value locale exclusion",
        expression:
          eligible.expression.replace(
            'not (http.cookie contains "locale=")',
            'not (http.cookie contains "locale=fr")',
          ) + ' and any(http.request.headers["accept-language"][*] wildcard "*en-US*")',
      } as never);
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("does not satisfy the cache policy contract");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("applies a valid payload supplied through --file", () => {
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      payload.request.description = "BRAWUKA-837: selected-file marker";
    });
    const { status, stdout } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).toBe(0);
    expect(stdout).toContain("ok: request ruleset applied");
    const log = fs.readFileSync(scratch.curlLog, "utf8").slice(before.length);
    expect(log).toContain("/rulesets/phases/http_request_cache_settings/entrypoint");
    expect(log).toContain("BRAWUKA-837: selected-file marker");
  });

  it("rejects a payload whose declared phase is not the phase it would be applied to", () => {
    const before = fs.readFileSync(scratch.curlLog, "utf8");
    const file = mutatedPayload((payload) => {
      payload.request.phase = "http_response_cache_settings";
    });
    const { status, stderr } = run(["--apply", "--phase", "request", "--file", file], {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("payload.request.phase");
    expect(fs.readFileSync(scratch.curlLog, "utf8")).toBe(before);
  });

  it("rejects an unknown argument", () => {
    const { status, stderr } = run(["--nope"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("unknown argument");
  });

  it("ships a rules file the applier can consume", () => {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(scratch.root, RULES), "utf8"),
    );
    if (!isRulesFile(parsed)) {
      throw new Error("rules file is not a ruleset file with a $note");
    }
    expect(parsed.$note).toContain("BRAWUKA-834");
    expect(parsed.request.phase).toBe("http_request_cache_settings");
    expect(parsed.request.rules).toHaveLength(4);
    expect(parsed.response?.phase).toBe("http_response_cache_settings");
  });
});
