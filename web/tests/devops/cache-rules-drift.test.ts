import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCacheRulesJson } from "../../scripts/lib/generate-cache-rules";

// BRAWUKA-184/821: deploy/dokploy/cache-rules.json is a generated artifact —
// the Cloudflare edge rule for the SSR /cafes/* shell. Its only source is
// `web/config/app.yaml` `seo.shellCache` mapped through
// `web/lib/cache-policy.ts` `cafeShellCdnRules()`. The deleted unit suite
// (BRAWUKA-682) was the last pin; this devops suite replaces it — same
// convention as migration-drift.test.ts, pure file I/O, no DB.
const CACHE_RULES = path.resolve(__dirname, "../../../deploy/dokploy/cache-rules.json");

describe("cafe-shell CDN cache rules", () => {
  it("cache-rules.json matches the generated contract (npm run gen:cache-rules)", () => {
    expect(readFileSync(CACHE_RULES, "utf8")).toBe(renderCacheRulesJson());
  });

  // The BRAWUKA-821 failure mode: the shell's locale resolves cookie →
  // Accept-Language (i18n/request.ts), but the edge key covered only the
  // header — a `locale=zh` request was served the cached en shell. The edge
  // rule MUST key on both inputs.
  it("keys the edge cache on every locale input (cookie + Accept-Language)", () => {
    const rules = JSON.parse(readFileSync(CACHE_RULES, "utf8"));
    expect(rules.varyOn).toContain("Accept-Language");
    expect(rules.varyOnCookies).toContain("locale");
    expect(rules.sharedCacheAcrossLocales).toBe(false);
  });
});
