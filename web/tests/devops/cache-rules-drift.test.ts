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
    // Response phase: a /cafes/* response carrying Set-Cookie is pinned
    // no-store (the request-side sb- bypass is only a proxy for it).
    const payload = JSON.parse(
      readFileSync(RULESET, "utf8"),
    ) as CloudflareCacheRuleset;
    expect(payload.response.phase).toBe("http_response_cache_settings");
    const setCookieRule = payload.response.rules.find((r) =>
      r.expression.includes('http.response.headers["set-cookie"]'),
    )!;
    expect(setCookieRule.action_parameters["no-store"]).toMatchObject({
      operation: "set",
    });
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
