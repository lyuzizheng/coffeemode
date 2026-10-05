import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderCacheRulesJson,
  renderCloudflareRulesJson,
} from "../../scripts/lib/generate-cache-rules";
import type { CloudflareCacheRuleset } from "@/lib/cache-policy";
import { evaluateRules } from "../../../scripts/devops/lib/rules-language.mjs";
import { checkCachePolicy } from "../../../scripts/devops/lib/cache-policy-checks.mjs";

// BRAWUKA-184/821/836: both deploy/dokploy artifacts are generated —
// cache-rules.json is the policy contract, cloudflare-cache-rules.json is
// the deployable Cloudflare ruleset applied by
// scripts/devops/apply-cache-rules.sh. Their only source is
// `web/config/app.yaml` `seo.shellCache` mapped through
// `web/lib/cache-policy.ts`. Byte-exact drift pins plus outcome coverage
// against the REAL generated payload, evaluated by the same
// rules-language engine check-cache-policy.mjs gates deployment with — a
// second in-repo outcome model would silently drift from the deployed
// semantics (r3 P2).
const DEPLOY_DIR = path.resolve(__dirname, "../../../deploy/dokploy");
const CONTRACT = path.join(DEPLOY_DIR, "cache-rules.json");
const RULESET = path.join(DEPLOY_DIR, "cloudflare-cache-rules.json");

const payload = JSON.parse(
  readFileSync(RULESET, "utf8"),
) as CloudflareCacheRuleset;
const ruleset = payload.request.rules;

/** Effective cache outcome for one request through the real payload. */
function outcome(req: {
  path: string;
  host: string;
  cookie: string;
  acceptLanguage: string;
}): "cache" | "bypass" | "uncached" {
  const { setting } = evaluateRules(ruleset, {
    host: req.host,
    path: req.path,
    cookie: req.cookie,
    acceptLanguage: [req.acceptLanguage],
  });
  return setting === true ? "cache" : setting === false ? "bypass" : "uncached";
}

const REQ = {
  prodEn: { path: "/cafes/x", host: "cafemood.app", cookie: "", acceptLanguage: "en-US,en;q=0.9" },
  zhCookie: { path: "/cafes/x", host: "cafemood.app", cookie: "locale=zh", acceptLanguage: "en-US,en;q=0.9" },
  zhHeader: { path: "/cafes/x", host: "cafemood.app", cookie: "", acceptLanguage: "zh-CN,zh;q=0.9" },
  zhTw: { path: "/cafes/x", host: "cafemood.app", cookie: "", acceptLanguage: "zh-TW" },
  auth: { path: "/cafes/x", host: "cafemood.app", cookie: "sb-access-token=eyJ…", acceptLanguage: "en" },
  staging: { path: "/cafes/x", host: "staging.cafemood.app", cookie: "", acceptLanguage: "en" },
  otherPath: { path: "/settings", host: "cafemood.app", cookie: "", acceptLanguage: "en" },
};

describe("cafe-shell CDN cache rules", () => {
  it("generated artifacts match the policy (npm run gen:cache-rules)", () => {
    expect(readFileSync(CONTRACT, "utf8")).toBe(renderCacheRulesJson());
    expect(readFileSync(RULESET, "utf8")).toBe(renderCloudflareRulesJson());
  });

  // The BRAWUKA-821 failure mode: the shell's locale resolves cookie →
  // Accept-Language (i18n/request.ts) but the live edge rule keyed on the
  // URL alone (BRAWUKA-834 readback) — a `locale=zh` request was served a
  // cached en shell. The deployable plan has no custom cache keys, so the
  // contract is a bypass list: any non-default-locale signal bypasses.
  it("keeps every non-default-locale request out of the shared cache", () => {
    expect(outcome(REQ.prodEn)).toBe("cache");
    expect(outcome(REQ.zhCookie)).toBe("bypass");
    expect(outcome(REQ.zhHeader)).toBe("bypass");
    expect(outcome(REQ.zhTw)).toBe("bypass");
    expect(outcome(REQ.auth)).toBe("bypass");
    expect(outcome(REQ.staging)).toBe("bypass");
    expect(outcome(REQ.otherPath)).toBe("uncached");
    expect(
      JSON.parse(readFileSync(CONTRACT, "utf8")).sharedCacheAcrossLocales,
    ).toBe(false);
  });

  // BRAWUKA-836: deny-first ordering — the /cafes/* catch-all bypass runs
  // FIRST, so under last-match-wins it can never disable the allow rule
  // (the v7 defect put an unconditional rule AFTER it). The allow rule
  // runs LAST and overrides the catch-all only where every exclusion
  // holds. Structure: catch-all deny, zone-wide bypasses (sb-, staging
  // host), allow last; response phase pins Set-Cookie responses no-store
  // (contract bypass.onResponseSetCookie).
  it("orders deny-first so excluded requests cannot reach the cache", () => {
    const catchAll = 'starts_with(http.request.uri.path, "/cafes/")';
    const allow = ruleset.at(-1)!;
    expect(allow.action_parameters.cache).toBe(true);
    expect(ruleset[0].expression).toBe(catchAll);
    expect(ruleset[0].action_parameters.cache).toBe(false);
    for (const rule of ruleset.slice(0, -1)) {
      expect(rule.action_parameters.cache).toBe(false);
    }
    // Every locale signal the allow rule negates is denied earlier — the
    // catch-all covers path-scoped signals; sb-/host have dedicated
    // zone-wide rules.
    const signalTerms = [...allow.expression.matchAll(/not \(([^)]+?)\)/g)]
      .map((m) => m[1]);
    expect(signalTerms.length).toBeGreaterThan(0);
    for (const rule of ruleset) {
      expect(rule.expression).not.toContain(" or ");
    }
  });

  it("does not declare custom cache keys the deployed plan cannot apply", () => {
    const contract = readFileSync(CONTRACT, "utf8");
    const payload = readFileSync(RULESET, "utf8");
    for (const text of [contract, payload]) {
      expect(text).not.toContain("varyOn");
      expect(text).not.toContain("custom_cache_key");
      expect(text).not.toContain("cache_key");
    }
  });

  // The deployed edge (ruleset v9) also runs an http_response_cache_settings
  // phase: a /cafes/* response carrying Set-Cookie is pinned no-store — the
  // request phase cannot see response headers, so this is the edge-side half
  // of contract bypass.onResponseSetCookie. Emitting it keeps the deployed
  // response ruleset reproducible rather than left as unmanaged drift.
  it("pins Set-Cookie /cafes/* responses no-store in the response phase", () => {
    const payload = JSON.parse(readFileSync(RULESET, "utf8")) as CloudflareCacheRuleset;
    expect(payload.response.phase).toBe("http_response_cache_settings");
    expect(
      payload.response.rules.some(
        (r) =>
          r.action === "set_cache_control" &&
          (r.action_parameters["no-store"] as { operation?: string } | undefined)?.operation === "set" &&
          r.expression.includes('http.response.headers["set-cookie"]') &&
          r.expression.includes('starts_with(http.request.uri.path, "/cafes/")'),
      ),
    ).toBe(true);
  });
});

// BRAWUKA-836/841 fault regressions: every crafted payload below defeats a
// TEXTUAL exclusion check (substring match, case-fold, `or` branch, nested
// negation) while still caching the protected request — the checker must
// fail closed on the semantic exclusion contract, not the expression text.
describe("cache-policy checker adversarial payloads", () => {
  const contract = JSON.parse(readFileSync(CONTRACT, "utf8"));
  const fresh = () =>
    JSON.parse(readFileSync(RULESET, "utf8")) as CloudflareCacheRuleset;
  const allowRule = (p: CloudflareCacheRuleset) =>
    p.request.rules.find((r) => r.action_parameters.cache === true)!;
  const probe = (p: CloudflareCacheRuleset, req: (typeof REQ)[keyof typeof REQ]) =>
    evaluateRules(p.request.rules, { ...req, acceptLanguage: [req.acceptLanguage] });
  const expectRejected = (
    p: CloudflareCacheRuleset,
    pattern: RegExp,
  ) => {
    const { failures } = checkCachePolicy(contract, p);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f: string) => pattern.test(f))).toBe(true);
  };

  it.each([
    {
      name: "uppercase auth term",
      mutate: (p: CloudflareCacheRuleset) => {
        allowRule(p).expression = allowRule(p).expression.replace('"sb-"', '"SB-"');
      },
      req: REQ.auth,
      pattern: /does not exclude cookiePrefix "sb-"/,
    },
    {
      name: "uppercase locale term",
      mutate: (p: CloudflareCacheRuleset) => {
        allowRule(p).expression = allowRule(p).expression.replace('"locale="', '"LOCALE="');
      },
      req: REQ.zhCookie,
      pattern: /does not exclude cookie "locale"/,
    },
    {
      name: "uppercase staging host",
      mutate: (p: CloudflareCacheRuleset) => {
        allowRule(p).expression = allowRule(p).expression.replace(
          '"staging.cafemood.app"',
          '"STAGING.CAFEMOOD.APP"',
        );
      },
      req: REQ.staging,
      pattern: /does not exclude hostname "staging.cafemood.app"/,
    },
    {
      name: "partial locale value",
      mutate: (p: CloudflareCacheRuleset) => {
        allowRule(p).expression = allowRule(p).expression.replace('"locale="', '"locale=fr"');
      },
      req: REQ.zhCookie,
      pattern: /does not exclude cookie "locale"/,
    },
    {
      name: "double-negated auth term",
      mutate: (p: CloudflareCacheRuleset) => {
        allowRule(p).expression = allowRule(p).expression.replace(
          'not (http.cookie contains "sb-")',
          'not (not (http.cookie contains "sb-"))',
        );
      },
      req: REQ.auth,
      pattern: /not\(not|does not exclude cookiePrefix "sb-"/,
    },
    {
      name: "or-branch bypasses exclusions",
      mutate: (p: CloudflareCacheRuleset) => {
        allowRule(p).expression = `${allowRule(p).expression} or (starts_with(http.request.uri.path, "/cafes/"))`;
      },
      // The 'or' form is outside the supported grammar: it must fail
      // closed on shape before any outcome is trusted.
      req: null,
      pattern: /\bor\b|cannot be evaluated|does not exclude/,
    },
    {
      name: "appended allow missing auth exclusion",
      mutate: (p: CloudflareCacheRuleset) => {
        p.request.rules.push({
          ...allowRule(p),
          description: "en-US allow without auth exclusion",
          expression: 'starts_with(http.request.uri.path, "/cafes/") and not (http.cookie contains "locale=") and not (any(http.request.headers["accept-language"][*] wildcard "*zh*")) and http.host ne "staging.cafemood.app"',
        });
      },
      req: REQ.auth,
      pattern: /does not exclude cookiePrefix "sb-"/,
    },
    {
      name: "appended allow missing staging exclusion",
      mutate: (p: CloudflareCacheRuleset) => {
        p.request.rules.push({
          ...allowRule(p),
          description: "en-US allow without staging exclusion",
          expression: 'starts_with(http.request.uri.path, "/cafes/") and not (http.cookie contains "sb-") and not (http.cookie contains "locale=") and not (any(http.request.headers["accept-language"][*] wildcard "*zh*"))',
        });
      },
      req: REQ.staging,
      pattern: /does not exclude hostname "staging.cafemood.app"/,
    },
  ])("rejects the $name fault", ({ mutate, req, pattern }) => {
    const p = fresh();
    mutate(p);
    if (req !== null) {
      // The fault is real only if the crafted rule still caches the
      // protected request through the real evaluator.
      expect(probe(p, req).setting).toBe(true);
    }
    expectRejected(p, pattern);
  });

  it("rejects an origin-TTL override on the allow rule", () => {
    const p = fresh();
    const parameters = allowRule(p).action_parameters;
    if (
      typeof parameters.edge_ttl === "object" &&
      parameters.edge_ttl !== null &&
      "mode" in parameters.edge_ttl
    ) {
      parameters.edge_ttl.mode = "override_origin";
    }
    expectRejected(p, /respect_origin/);
  });

  it("rejects a disabled required bypass", () => {
    const p = fresh();
    const stagingBypass = p.request.rules.find((r) =>
      r.expression.includes('http.host eq "staging.cafemood.app"'),
    )!;
    stagingBypass.enabled = false;
    expectRejected(p, /no bypass covers hostname|enabled/);
  });

  it("rejects a missing response-phase no-store rule", () => {
    const p = fresh();
    p.response.rules = [];
    expectRejected(p, /no-store|no_store/);
  });
});
