import { describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE_NAME,
  AGENT_QA_EGO_PROFILE_ID,
  assertSingleHostOnlyAccessCookie,
  cookieDomainApplies,
  ensureSingleAccessCookie,
  fetchAccessCookie,
  isHostOnlyCookieFor,
  readAccessCookieValue,
  resolveAgentQaProfile,
  shadowingAccessCookies,
  verifySingleAccessCookie,
} from "../../../scripts/agent-qa/access-cookie.mjs";

// BRAWUKA-1026: the nightly QA runner stopped at the Cloudflare Access login
// page because its browser profile was the shared one. A session
// `CF_Authorization` scoped to `.cafemood.app` was sent ahead of the host-only
// cookie the runner stamped, Cloudflare answered 302, and zero journeys ran.
//
// The contract under test: QA runs on a dedicated profile, deletes every
// same-name cookie that would shadow the staging host, stamps a host-only
// cookie, and fails closed (`env-failure:access-cookie-shadowed`) when the jar
// still holds more than one — instead of spending a round on the login page.

const STAGING_HOST = "staging.cafemood.app";
const STAGING_URL = `https://${STAGING_HOST}/api/health`;
const PAIR = { clientId: "access-id-sentinel", clientSecret: "access-secret-sentinel" };

type CdpCookie = { name: string; value?: string; domain: string; path?: string };

type CdpCall = { method: string; params?: Record<string, unknown> };

/**
 * In-memory Chromium jar for the CDP methods this module uses. `deleteCookies`
 * honours (name, domain, path) like the real Network domain; `getCookies`
 * filters by domain applicability, which is the part the bug depended on.
 */
function fakePage(initial: CdpCookie[], { ignoreDeletes = false, userAgent = "" } = {}) {
  const jar = initial.map((cookie) => ({ path: "/", value: "", ...cookie })) as Required<CdpCookie>[];
  const calls: CdpCall[] = [];

  const page = {
    async evaluate(): Promise<unknown> {
      return userAgent;
    },
    async cdp(method: string, params?: unknown): Promise<unknown> {
      const p = (params ?? {}) as Record<string, unknown>;
      calls.push({ method, params: p });
      if (method === "Network.getAllCookies") return { cookies: jar.map((cookie) => ({ ...cookie })) };
      if (method === "Network.deleteCookies") {
        if (ignoreDeletes) return {};
        const index = jar.findIndex(
          (cookie) => cookie.name === p.name && cookie.domain === p.domain && cookie.path === (p.path ?? "/"),
        );
        if (index >= 0) jar.splice(index, 1);
        return {};
      }
      if (method === "Network.setCookie") {
        const host = new URL(String(p.url)).hostname;
        const cookie = {
          name: String(p.name),
          value: String(p.value),
          domain: host,
          path: String(p.path ?? "/"),
        };
        const index = jar.findIndex((c) => c.name === cookie.name && c.domain === host && c.path === cookie.path);
        if (index >= 0) jar[index] = cookie;
        else jar.push(cookie);
        return { success: true };
      }
      throw new Error(`fakePage does not implement ${method}`);
    },
  };

  return { page, jar, calls };
}

function fakeResponse(status: number, setCookies: string[] = []): Response {
  const headers = new Headers();
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

describe("agent-QA Access cookie bootstrap (BRAWUKA-1026)", () => {
  describe("dedicated profile", () => {
    it("resolves the built-in Default profile from profiles()", () => {
      const profile = resolveAgentQaProfile([
        { id: "Profile 1", name: "Zizheng Lyu", isDefault: true },
        { id: AGENT_QA_EGO_PROFILE_ID, name: "Your ego" },
      ]);

      expect(profile.id).toBe(AGENT_QA_EGO_PROFILE_ID);
    });

    it("fails closed instead of falling back to the personal profile", () => {
      expect(() => resolveAgentQaProfile([{ id: "Profile 1", name: "Zizheng Lyu", isDefault: true }])).toThrow(
        /env-failure:qa-profile-missing/,
      );
      expect(() => resolveAgentQaProfile(undefined)).toThrow(/env-failure:qa-profile-missing/);
    });
  });

  describe("cookie domain matching", () => {
    it("matches a leading-dot domain against subdomains and a bare domain exactly", () => {
      expect(cookieDomainApplies(STAGING_HOST, STAGING_HOST)).toBe(true);
      expect(cookieDomainApplies(`.${STAGING_HOST}`, STAGING_HOST)).toBe(true);
      expect(cookieDomainApplies(".cafemood.app", STAGING_HOST)).toBe(true);
      expect(cookieDomainApplies(".app", STAGING_HOST)).toBe(true);
      // Host-only cookie on the parent: Chromium never sends it to a subdomain.
      expect(cookieDomainApplies("cafemood.app", STAGING_HOST)).toBe(false);
      expect(cookieDomainApplies("cafemood.app", "cafemood.app")).toBe(true);
    });

    it("rejects unrelated, empty, and production-host domains for the staging host", () => {
      expect(cookieDomainApplies(".cafemood.com", STAGING_HOST)).toBe(false);
      expect(cookieDomainApplies("staging-images.cafemood.app", STAGING_HOST)).toBe(false);
      expect(cookieDomainApplies("", STAGING_HOST)).toBe(false);
      expect(cookieDomainApplies(".cafemood.app", "")).toBe(false);
      expect(cookieDomainApplies(".cafemood.app", "cafemood.app")).toBe(true);
    });

    it("accepts only the bare host as host-only", () => {
      expect(isHostOnlyCookieFor({ domain: STAGING_HOST }, STAGING_HOST)).toBe(true);
      expect(isHostOnlyCookieFor({ domain: `.${STAGING_HOST}` }, STAGING_HOST)).toBe(false);
      expect(isHostOnlyCookieFor({ domain: ".cafemood.app" }, STAGING_HOST)).toBe(false);
    });
  });

  describe("shadow detection", () => {
    it("flags the parent-domain cookie that shadowed the host-only one", () => {
      const cookies = [
        { name: ACCESS_COOKIE_NAME, domain: ".cafemood.app" },
        { name: ACCESS_COOKIE_NAME, domain: STAGING_HOST },
        { name: "theme", domain: STAGING_HOST },
        { name: ACCESS_COOKIE_NAME, domain: ".other.app" },
      ];

      expect(shadowingAccessCookies(cookies, STAGING_HOST).map((c) => c.domain)).toEqual([".cafemood.app"]);
    });

    it("flags a dotted host-scoped duplicate too", () => {
      const cookies = [{ name: ACCESS_COOKIE_NAME, domain: `.${STAGING_HOST}` }];

      expect(shadowingAccessCookies(cookies, STAGING_HOST)).toHaveLength(1);
    });

    it("leaves a single canonical cookie alone", () => {
      expect(shadowingAccessCookies([{ name: ACCESS_COOKIE_NAME, domain: STAGING_HOST }], STAGING_HOST)).toEqual([]);
    });

    it("leaves a host-only cookie for another host alone", () => {
      expect(shadowingAccessCookies([{ name: ACCESS_COOKIE_NAME, domain: "cafemood.app" }], STAGING_HOST)).toEqual([]);
    });

    it("flags a same-name cookie on another path", () => {
      const cookies = [{ name: ACCESS_COOKIE_NAME, domain: STAGING_HOST, path: "/api" }];

      expect(shadowingAccessCookies(cookies, STAGING_HOST)).toHaveLength(1);
    });
  });

  describe("single host-only invariant", () => {
    it("accepts exactly one host-only cookie", () => {
      expect(() =>
        assertSingleHostOnlyAccessCookie(
          [
            { name: ACCESS_COOKIE_NAME, domain: STAGING_HOST },
            { name: "theme", domain: STAGING_HOST },
          ],
          STAGING_HOST,
        ),
      ).not.toThrow();
    });

    it("fails closed on zero, two, or a lone parent-domain cookie", () => {
      expect(() => assertSingleHostOnlyAccessCookie([], STAGING_HOST)).toThrow(/found 0/);
      expect(() =>
        assertSingleHostOnlyAccessCookie(
          [
            { name: ACCESS_COOKIE_NAME, domain: ".cafemood.app" },
            { name: ACCESS_COOKIE_NAME, domain: STAGING_HOST },
          ],
          STAGING_HOST,
        ),
      ).toThrow(/found 2 \(domains: \.cafemood\.app, staging\.cafemood\.app; paths: \/, \//);

      // A second cookie on another path is sent to that path and can shadow there.
      expect(() =>
        assertSingleHostOnlyAccessCookie(
          [{ name: ACCESS_COOKIE_NAME, domain: STAGING_HOST, path: "/api" }],
          STAGING_HOST,
        ),
      ).toThrow(/found 1 \(domains: staging\.cafemood\.app; paths: \/api\)/);
      expect(() =>
        assertSingleHostOnlyAccessCookie([{ name: ACCESS_COOKIE_NAME, domain: ".cafemood.app" }], STAGING_HOST),
      ).toThrow(/env-failure:access-cookie-shadowed/);
    });
  });

  describe("bootstrap response parsing", () => {
    it("picks CF_Authorization out of a multi-cookie response", () => {
      const headers = new Headers();
      headers.append("set-cookie", "cf_clearance=other-value; Path=/; Secure");
      headers.append("set-cookie", `${ACCESS_COOKIE_NAME}=jwt.value.sentinel; Domain=${STAGING_HOST}; Path=/; HttpOnly`);
      headers.append("set-cookie", "theme=dark; Path=/");

      expect(readAccessCookieValue(headers)).toBe("jwt.value.sentinel");
    });

    it("returns null when the cookie is absent or empty", () => {
      const headers = new Headers();
      headers.append("set-cookie", "theme=dark; Path=/");

      expect(readAccessCookieValue(headers)).toBeNull();
      expect(readAccessCookieValue(undefined)).toBeNull();

      const empty = new Headers();
      empty.append("set-cookie", `${ACCESS_COOKIE_NAME}=; Path=/`);
      expect(readAccessCookieValue(empty)).toBeNull();
    });
  });

  describe("token-pair trade", () => {
    it("keeps the pair on an Access host and never follows a redirect", async () => {
      const requests: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return fakeResponse(200, [`${ACCESS_COOKIE_NAME}=fresh-token; Domain=${STAGING_HOST}; Path=/; HttpOnly`]);
      }) as typeof fetch;

      await expect(
        fetchAccessCookie(STAGING_URL, PAIR, { fetchImpl, userAgent: "Mozilla/5.0 (TestBrowser)" }),
      ).resolves.toBe("fresh-token");

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(STAGING_URL);
      expect(requests[0].init?.redirect).toBe("manual");
      const headers = requests[0].init?.headers as Record<string, string>;
      expect(headers["CF-Access-Client-Id"]).toBe(PAIR.clientId);
      expect(headers["CF-Access-Client-Secret"]).toBe(PAIR.clientSecret);
      expect(headers["user-agent"]).toBe("Mozilla/5.0 (TestBrowser)");
    });

    it("presents a browser user agent by default, never Node's", async () => {
      const requests: Array<{ init?: RequestInit }> = [];
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push({ init });
        return fakeResponse(200, [`${ACCESS_COOKIE_NAME}=fresh-token; Path=/`]);
      }) as typeof fetch;

      await fetchAccessCookie(STAGING_URL, PAIR, { fetchImpl });

      const headers = requests[0].init?.headers as Record<string, string>;
      expect(headers["user-agent"]).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
    });

    it("stops on a redirect status without following it", async () => {
      const fetchImpl = (async () => fakeResponse(302)) as typeof fetch;

      await expect(fetchAccessCookie(STAGING_URL, PAIR, { fetchImpl })).rejects.toThrow(/HTTP 302/);
    });

    it("stops when the response carries no CF_Authorization", async () => {
      const fetchImpl = (async () => fakeResponse(200, ["theme=dark; Path=/"])) as typeof fetch;

      await expect(fetchAccessCookie(STAGING_URL, PAIR, { fetchImpl })).rejects.toThrow(
        /no CF_Authorization \(env-failure:access-token-rejected\)/,
      );
    });

    it.each([
      ["http://staging.cafemood.app/api/health", "plaintext"],
      ["https://staging.cafemood.app:8443/api/health", "an alternate port"],
      ["https://coffeemode.cloudflareaccess.com/api/health", "an unconfigured Access tenant"],
      ["https://staging-images.cafemood.app/health", "a sibling staging host"],
      ["https://cafemood.app/api/health", "the apex host"],
    ])("refuses %s (%s) before sending the pair", async (url) => {
      let called = false;
      const fetchImpl = (async () => {
        called = true;
        return fakeResponse(200);
      }) as typeof fetch;

      await expect(fetchAccessCookie(url, PAIR, { fetchImpl })).rejects.toThrow(/refused origin/);
      expect(called).toBe(false);
    });

    it("accepts the exact credential origin", async () => {
      const fetchImpl = (async () => fakeResponse(200, [`${ACCESS_COOKIE_NAME}=cookie-value; Path=/`])) as typeof fetch;

      await expect(fetchAccessCookie(STAGING_URL, PAIR, { fetchImpl })).resolves.toBe("cookie-value");
    });
  });

  describe("per-round bootstrap", () => {
    it("purges the shadow, stamps host-only, and verifies one cookie", async () => {
      const { page, jar, calls } = fakePage(
        [
          { name: ACCESS_COOKIE_NAME, domain: ".cafemood.app", value: "stale-parent-domain" },
          { name: ACCESS_COOKIE_NAME, domain: STAGING_HOST, value: "stale-api", path: "/api" },
          { name: "theme", domain: STAGING_HOST, value: "dark" },
        ],
        { userAgent: "Mozilla/5.0 (QaBrowser) Chrome/152.0.0.0" },
      );
      const fetchHeaders: Array<Record<string, string>> = [];
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        fetchHeaders.push(init?.headers as Record<string, string>);
        return fakeResponse(200, [`${ACCESS_COOKIE_NAME}=fresh-token; Path=/`]);
      }) as typeof fetch;

      await expect(ensureSingleAccessCookie(page, { stagingUrl: STAGING_URL, pair: PAIR, fetchImpl })).resolves.toEqual(
        { purgedDomains: [".cafemood.app", STAGING_HOST] },
      );

      expect(fetchHeaders[0]["user-agent"]).toBe("Mozilla/5.0 (QaBrowser) Chrome/152.0.0.0");

      expect(jar.filter((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toEqual([
        { name: ACCESS_COOKIE_NAME, value: "fresh-token", domain: STAGING_HOST, path: "/" },
      ]);
      expect(jar.find((cookie) => cookie.name === "theme")).toEqual({
        name: "theme",
        value: "dark",
        domain: STAGING_HOST,
        path: "/",
      });

      const stamp = calls.find((call) => call.method === "Network.setCookie");
      expect(stamp?.params).toMatchObject({ url: `https://${STAGING_HOST}/`, path: "/", secure: true, httpOnly: true });
      expect(stamp?.params).not.toHaveProperty("domain");
    });

    it("refuses an off-origin URL before touching the jar", async () => {
      const { page, calls } = fakePage([]);
      const fetchImpl = (async () => fakeResponse(200)) as typeof fetch;

      await expect(
        ensureSingleAccessCookie(page, {
          stagingUrl: "https://staging.cafemood.app:8443/",
          pair: PAIR,
          fetchImpl,
        }),
      ).rejects.toThrow(/refused origin/);
      expect(calls).toEqual([]);
    });

    it("fails closed when a same-name cookie is scoped to another path", async () => {
      const { page } = fakePage([
        { name: ACCESS_COOKIE_NAME, domain: STAGING_HOST, value: "root", path: "/" },
        { name: ACCESS_COOKIE_NAME, domain: STAGING_HOST, value: "api", path: "/api" },
      ]);

      await expect(verifySingleAccessCookie(page, STAGING_URL)).rejects.toThrow(
        /found 2 \(domains: staging\.cafemood\.app, staging\.cafemood\.app; paths: \/, \/api\)/,
      );
    });

    it("falls back to the browser constant when the page reports no UA", async () => {
      const { page } = fakePage([]);
      const seen: string[] = [];
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push((init?.headers as Record<string, string>)["user-agent"]);
        return fakeResponse(200, [`${ACCESS_COOKIE_NAME}=fresh-token; Path=/`]);
      }) as typeof fetch;

      await ensureSingleAccessCookie(page, { stagingUrl: STAGING_URL, pair: PAIR, fetchImpl });

      expect(seen[0]).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
    });

    it("fails closed with the run-log signature when a shadow survives deletion", async () => {
      const { page } = fakePage([{ name: ACCESS_COOKIE_NAME, domain: ".cafemood.app", value: "stale-parent-domain" }], {
        ignoreDeletes: true,
      });
      const fetchImpl = (async () => fakeResponse(200, [`${ACCESS_COOKIE_NAME}=fresh-token; Path=/`])) as typeof fetch;

      await expect(ensureSingleAccessCookie(page, { stagingUrl: STAGING_URL, pair: PAIR, fetchImpl })).rejects.toThrow(
        /env-failure:access-cookie-shadowed — 1 non-canonical CF_Authorization cookie\(s\) survived/,
      );
    });

    it("never reports a cookie value in the failure it raises", async () => {
      const { page } = fakePage([{ name: ACCESS_COOKIE_NAME, domain: ".cafemood.app", value: "secret-value" }], {
        ignoreDeletes: true,
      });
      const fetchImpl = (async () => fakeResponse(200, [`${ACCESS_COOKIE_NAME}=fresh-token; Path=/`])) as typeof fetch;

      const error = await ensureSingleAccessCookie(page, { stagingUrl: STAGING_URL, pair: PAIR, fetchImpl }).then(
        () => null,
        (reason: Error) => reason,
      );

      expect(error?.message).toContain("env-failure:access-cookie-shadowed");
      expect(error?.message).not.toContain("secret-value");
    });
  });
});
