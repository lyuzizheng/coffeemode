import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderCacheRulesJson,
  renderCloudflareRulesJson,
} from "../../scripts/lib/generate-cache-rules";
import { cafeShellCacheOutcome } from "@/lib/cache-policy";
import type { CloudflareCacheRuleset } from "@/lib/cache-policy";
import { loadYaml, parseAppConfig } from "@/lib/config-schema";

// BRAWUKA-184/821/836: both deploy/dokploy artifacts are generated —
// cache-rules.json is the policy contract, cloudflare-cache-rules.json is
// the deployable Cloudflare ruleset applied by
// scripts/devops/apply-cache-rules.sh. Their only source is
// `web/config/app.yaml` `seo.shellCache` mapped through
// `web/lib/cache-policy.ts`. Byte-exact drift pins plus policy-level
// effective-outcome coverage (the BRAWUKA-836 review finding: membership
// tests never proved the allow rule stays reachable).
const DEPLOY_DIR = path.resolve(__dirname, "../../../deploy/dokploy");
const CONTRACT = path.join(DEPLOY_DIR, "cache-rules.json");
const RULESET = path.join(DEPLOY_DIR, "cloudflare-cache-rules.json");

const policy = parseAppConfig(loadYaml("app.yaml")).seo.shellCache;
// Repo-generated file, shape fixed by cafeShellCloudflareRuleset() — the
// byte-exact drift pin above already proves the committed payload.
const ruleset = (JSON.parse(readFileSync(RULESET, "utf8")) as CloudflareCacheRuleset).request.rules;

const REQ = {
  prodEn: { path: "/cafes/x", host: "cafemood.app", cookie: "", acceptLanguage: "en-US,en;q=0.9" },
  zhCookie: { path: "/cafes/x", host: "cafemood.app", cookie: "locale=zh", acceptLanguage: "en-US,en;q=0.9" },
  zhHeader: { path: "/cafes/x", host: "cafemood.app", cookie: "", acceptLanguage: "zh-CN,zh;q=0.9" },
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
    expect(cafeShellCacheOutcome(policy, REQ.prodEn)).toBe("cache");
    expect(cafeShellCacheOutcome(policy, REQ.zhCookie)).toBe("bypass");
    expect(cafeShellCacheOutcome(policy, REQ.zhHeader)).toBe("bypass");
    expect(cafeShellCacheOutcome(policy, REQ.auth)).toBe("bypass");
    expect(cafeShellCacheOutcome(policy, REQ.staging)).toBe("bypass");
    expect(cafeShellCacheOutcome(policy, REQ.otherPath)).toBe("uncached");
    expect(
      JSON.parse(readFileSync(CONTRACT, "utf8")).sharedCacheAcrossLocales,
    ).toBe(false);
  });

  // BRAWUKA-836: every negated exclusion in the allow rule must be
  // mirrored by a positive bypass term — the complement — or the
  // excluded request could match a caching rule (or an unconditional
  // catch-all would also match default-locale requests and disable the
  // allow rule under last-match-wins, the v7 defect). Structure: allow
  // first, then zone-wide bypasses, then one `/cafes/ AND <signal>` rule
  // per locale signal.
  it("bypasses exactly the requests the allow rule excluded", () => {
    const allow = ruleset[0];
    const bypasses = ruleset.slice(1);
    expect(allow.action_parameters.cache).toBe(true);
    for (const rule of bypasses) {
      expect(rule.action_parameters.cache).toBe(false);
    }
    // Every locale signal has BOTH a negated allow-term and a positive
    // path-scoped bypass rule.
    const localeBypasses = bypasses.filter((r) => r.expression.includes("/cafes/"));
    const signalTerms = [...allow.expression.matchAll(/not \(([^)]+?)\)/g)]
      .map((m) => m[1])
      .filter((t) => !t.includes("sb-")); // sb- + host bypass zone-wide below
    for (const term of signalTerms) {
      expect(
        localeBypasses.some((r) => r.expression.includes(term)),
        `no path-scoped bypass mirrors allow-term "${term}"`,
      ).toBe(true);
    }
    // No rule may be an unconditional /cafes/ catch-all — that is the
    // BRAWUKA-836 defect shape (matches the allow rule's own requests).
    for (const rule of ruleset) {
      expect(rule.expression).not.toBe(`starts_with(http.request.uri.path, "/cafes/")`);
      if (rule !== allow) {
        expect(rule.expression).not.toContain(" or ");
      }
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
          r.action_parameters["no-store"]?.operation === "set" &&
          r.expression.includes('http.response.headers["set-cookie"]') &&
          r.expression.includes('starts_with(http.request.uri.path, "/cafes/")'),
      ),
    ).toBe(true);
  });
});
