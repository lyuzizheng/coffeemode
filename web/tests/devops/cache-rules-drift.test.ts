import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCacheRulesJson } from "../../scripts/lib/generate-cache-rules";

// BRAWUKA-184/834: deploy/dokploy/cache-rules.json is a generated artifact —
// the Cloudflare http_request_cache_settings ruleset for the SSR /cafes/*
// shell. Its only source is `web/config/app.yaml` `seo.shellCache` mapped
// through `web/lib/cache-policy.ts` `cafeShellCdnRules()`. The deleted unit
// suite (BRAWUKA-682) was the last pin; this devops suite replaces it — same
// convention as migration-drift.test.ts, pure file I/O, no DB.

/** Boundary type for the generated artifact — checked byte-exactly above,
 *  so the parse is trusted; the shape below exists for member typing. */
interface EdgeRule {
  expression: string;
  action_parameters: {
    cache: boolean;
    edge_ttl?: {
      mode: string;
      status_code_ttl: Array<{
        status_code_range: { from: number; to?: number };
        value: number;
      }>;
    };
  };
}
const CACHE_RULES = path.resolve(__dirname, "../../../deploy/dokploy/cache-rules.json");

describe("cafe-shell CDN cache rules", () => {
  it("cache-rules.json matches the generated contract (npm run gen:cache-rules)", () => {
    expect(readFileSync(CACHE_RULES, "utf8")).toBe(renderCacheRulesJson());
  });

  // The BRAWUKA-821/834 failure mode: the shell's locale resolves
  // cookie → Accept-Language (i18n/request.ts), but the edge cache key is
  // URL-only — custom cache keys are Enterprise-only, so the earlier
  // varyOn/varyOnCookies declaration had no mechanism behind it and a
  // `locale=zh` request was served the cached en shell. The only
  // enforceable contract is a bypass: the shared entry may hold ONLY the
  // default-locale shell, so the cacheable rule MUST exclude every
  // locale-negotiated request and a catch-all bypass MUST cover the rest
  // of /cafes/*.
  it("keeps every locale-negotiated /cafes/* request out of the shared cache", () => {
    const ruleset: { phase: string; rules: EdgeRule[] } = JSON.parse(
      readFileSync(CACHE_RULES, "utf8"),
    );
    expect(ruleset.phase).toBe("http_request_cache_settings");

    const cacheable = ruleset.rules.find((r) => r.action_parameters.cache);
    expect(cacheable).toBeDefined();
    // Locale inputs are bypass exclusions, not key inputs.
    for (const exclusion of [
      'http.cookie contains "sb-"',
      'http.cookie contains "locale="',
      'wildcard "*zh*"',
      'http.host ne "staging.cafemood.app"',
    ]) {
      expect(cacheable?.expression).toContain(exclusion);
    }

    // A catch-all bypass covers every /cafes/* request the cacheable rule
    // rejects — under either first-match or last-match semantics.
    expect(
      ruleset.rules.some(
        (r) =>
          !r.action_parameters.cache &&
          r.expression === 'starts_with(http.request.uri.path, "/cafes/")',
      ),
    ).toBe(true);

    // Spec 0005 §3: the staging host bypasses every route.
    expect(
      ruleset.rules.some(
        (r) =>
          !r.action_parameters.cache &&
          r.expression === 'http.host eq "staging.cafemood.app"',
      ),
    ).toBe(true);

    // Non-200/304 statuses are no-store (gone-cafe 404 must never be
    // cached); 200 and 304 stay outside every no-store range.
    const edgeTtl = cacheable?.action_parameters.edge_ttl;
    expect(edgeTtl?.mode).toBe("respect_origin");
    expect(edgeTtl?.status_code_ttl).toBeDefined();
    const coveredStatuses = (target: number) =>
      edgeTtl?.status_code_ttl.some(
        (t) =>
          t.status_code_range.from <= target &&
          target <= (t.status_code_range.to ?? Number.POSITIVE_INFINITY),
      );
    expect(coveredStatuses(404)).toBe(true);
    expect(coveredStatuses(200)).toBe(false);
    expect(coveredStatuses(304)).toBe(false);
  });
});
