import { describe, expect, it } from "vitest";
import {
  MANIFEST_CONTENT_TYPE,
  MANIFEST_PATH,
  MANIFEST_UNVERIFIED_SIGNATURE,
  captureManifestResponse,
  classifyManifestEvidence,
  describeManifestVerdict,
  normalizeAccessLoginOrigin,
  parseAccessLoginDestination,
  stripQuery,
  summarizeManifestEvidence,
} from "../../../scripts/agent-qa/manifest-probe.mjs";

// BRAWUKA-1047: the scheduled round stopped before any journey because the
// manifest's 302 was looked for in `Network.responseReceived`, which Chromium
// never emits for a redirected manifest. The redirect lives on the next
// `Network.requestWillBeSent` (`redirectResponse`), and the login page's final
// 200 must never be mistaken for the manifest's own status.
//
// The contract under test: accept a verified 200 carrying the manifest MIME, or
// a 302 whose destination is the CONFIGURED Access login page for this host
// (reported without the query); the first manifest hop is authoritative; every
// other shape, including no observed response, stops the round with
// `env-failure:manifest-response-unverified`.

const STAGING_URL = "https://staging.cafemood.app/api/health";
const MANIFEST_URL = `https://staging.cafemood.app${MANIFEST_PATH}`;
const ACCESS_LOGIN_ORIGIN = "https://qa-team.cloudflareaccess.com";
const LOGIN_URL = `${ACCESS_LOGIN_ORIGIN}/cdn-cgi/access/login/staging.cafemood.app`;
const OTHER_LOGIN = "https://other-team.cloudflareaccess.com/cdn-cgi/access/login/staging.cafemood.app";

type CdpEvent = { method: string; params: Record<string, unknown> };

function request(id: string, url: string, type = "Manifest", redirectResponse?: Record<string, unknown>): CdpEvent {
  return { method: "Network.requestWillBeSent", params: { requestId: id, type, request: { url }, redirectResponse } };
}

function response(id: string, url: string, status: number, contentType = MANIFEST_CONTENT_TYPE): CdpEvent {
  return {
    method: "Network.responseReceived",
    params: { requestId: id, type: "Manifest", response: { url, status, headers: { "content-type": contentType } } },
  };
}

function failed(id: string, errorText: string): CdpEvent {
  return { method: "Network.loadingFailed", params: { requestId: id, errorText } };
}

function manifestVerdict(events: CdpEvent[]) {
  return classifyManifestEvidence(summarizeManifestEvidence(events, { manifestUrl: MANIFEST_URL }), {
    stagingUrl: STAGING_URL,
    accessLoginOrigin: ACCESS_LOGIN_ORIGIN,
  });
}

function fakePage(batches: CdpEvent[][], { gotoError }: { gotoError?: string } = {}) {
  const calls: { method: string; params?: unknown }[] = [];
  const navigations: string[] = [];
  const queue = [...batches];
  return {
    calls,
    navigations,
    page: {
      async cdp(method: string, params?: unknown) {
        calls.push({ method, params });
        return {};
      },
      async events() {
        return queue.shift() ?? [];
      },
      async goto(url: string) {
        if (gotoError) throw new Error(gotoError);
        navigations.push(url);
        return {};
      },
      async waitForTimeout() {
        return undefined;
      },
    },
  };
}

describe("manifest response probe (BRAWUKA-1047)", () => {
  describe("verify a 302 from the redirect event, not responseReceived", () => {
    it("accepts the Access login redirect and reports the destination without the query", () => {
      const events = [
        request("7", MANIFEST_URL),
        request("7", `${LOGIN_URL}?redirect_url=/manifest.webmanifest&token=sentinel`, "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: `${LOGIN_URL}?redirect_url=/manifest.webmanifest&token=sentinel` },
        }),
        response("7", `${LOGIN_URL}?redirect_url=/manifest.webmanifest&token=sentinel`, 200, "text/html"),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(true);
      expect(verdict.outcome).toBe("access-redirect");
      expect(verdict.status).toBe(302);
      expect(verdict.accessLoginUrl).toBe(LOGIN_URL);
      expect(verdict.accessLoginUrl).not.toContain("?");
      expect(verdict.requestCount).toBe(1);
      expect(verdict.observed).toEqual([
        { status: 302, destination: LOGIN_URL, failure: null, contentType: null },
      ]);
      expect(describeManifestVerdict(verdict)).toBe(`HTTP 302 to the Access login page ${LOGIN_URL}`);
    });

    it("matches the Location header case-insensitively", () => {
      const events = [
        request("8", MANIFEST_URL),
        request("8", `${LOGIN_URL}?redirect_url=/manifest.webmanifest`, "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { Location: `${LOGIN_URL}?redirect_url=/manifest.webmanifest` },
        }),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(true);
      expect(verdict.accessLoginUrl).toBe(LOGIN_URL);
    });

    it("rejects a relative Location, which resolves onto the staging host and cannot be the Access tenant", () => {
      const events = [
        request("81", MANIFEST_URL),
        request("81", "/cdn-cgi/access/login/staging.cafemood.app", "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: "/cdn-cgi/access/login/staging.cafemood.app" },
        }),
      ];

      expect(manifestVerdict(events).accepted).toBe(false);
    });

    it("accepts a verified 200 for the manifest URL", () => {
      const verdict = manifestVerdict([request("9", MANIFEST_URL), response("9", MANIFEST_URL, 200)]);

      expect(verdict.accepted).toBe(true);
      expect(verdict.outcome).toBe("manifest");
      expect(verdict.status).toBe(200);
      expect(verdict.contentType).toBe(MANIFEST_CONTENT_TYPE);
      expect(verdict.accessLoginUrl).toBeNull();
      expect(verdict.observed).toEqual([
        { status: 200, destination: null, failure: null, contentType: MANIFEST_CONTENT_TYPE },
      ]);
    });

    it("rejects HTTP 200 text/html at the manifest URL — a login or error page is not the manifest", () => {
      const verdict = manifestVerdict([
        request("9h", MANIFEST_URL),
        response("9h", MANIFEST_URL, 200, "text/html; charset=utf-8"),
      ]);

      expect(verdict.accepted).toBe(false);
      expect(describeManifestVerdict(verdict)).toBe("HTTP 200 (text/html; charset=utf-8)");
    });

    it("keeps the other requests' evidence on an accepted verdict so the run log is complete", () => {
      const events = [
        request("9a", MANIFEST_URL),
        request("9a", LOGIN_URL, "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: LOGIN_URL },
        }),
        request("9b", MANIFEST_URL),
        response("9b", MANIFEST_URL, 404, "text/html"),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(true);
      expect(verdict.requestCount).toBe(2);
      expect(verdict.observed).toEqual([
        { status: 302, destination: LOGIN_URL, failure: null, contentType: null },
        { status: 404, destination: null, failure: null, contentType: "text/html" },
      ]);
    });

    it("accepts when a second manifest request is the one that verifies", () => {
      const events = [
        request("10a", MANIFEST_URL),
        request("10b", MANIFEST_URL),
        response("10b", MANIFEST_URL, 200),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(true);
      expect(verdict.outcome).toBe("manifest");
      expect(verdict.requestCount).toBe(2);
    });

    it("does not attach a loading failure of the login hop to the manifest's accepted redirect", () => {
      const events = [
        request("11", MANIFEST_URL),
        request("11", LOGIN_URL, "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: LOGIN_URL },
        }),
        failed("11", "net::ERR_ABORTED"),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(true);
      expect(verdict.outcome).toBe("access-redirect");
    });
  });

  describe("reject an unaccepted or unobserved response", () => {
    it("rejects two manifest requests with no terminal event — the round that filed this issue", () => {
      const verdict = manifestVerdict([request("12a", MANIFEST_URL), request("12b", MANIFEST_URL)]);

      expect(verdict.accepted).toBe(false);
      expect(verdict.requestCount).toBe(2);
      expect(verdict.observed).toEqual([
        { status: null, destination: null, failure: null, contentType: null },
        { status: null, destination: null, failure: null, contentType: null },
      ]);
      expect(describeManifestVerdict(verdict)).toBe("no HTTP response; no HTTP response");
    });

    it("rejects a redirect to somewhere other than this host's Access login page", () => {
      const events = [
        request("13", MANIFEST_URL),
        request("13", "https://elsewhere.example/login?token=sentinel", "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: "https://elsewhere.example/login?token=sentinel" },
        }),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(false);
      expect(describeManifestVerdict(verdict)).toBe("HTTP 302 -> https://elsewhere.example/login");
      expect(describeManifestVerdict(verdict)).not.toContain("sentinel");
    });

    it("rejects an Access login page for a different host", () => {
      const events = [
        request("14", MANIFEST_URL),
        request("14", "https://qa-team.cloudflareaccess.com/cdn-cgi/access/login/evil.example", "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: "https://qa-team.cloudflareaccess.com/cdn-cgi/access/login/evil.example" },
        }),
      ];

      expect(manifestVerdict(events).accepted).toBe(false);
    });

    it("rejects another Access tenant's login page even when its path matches", () => {
      const events = [
        request("14b", MANIFEST_URL),
        request("14b", OTHER_LOGIN, "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: OTHER_LOGIN },
        }),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(false);
      expect(verdict.observed[0].destination).toBe(OTHER_LOGIN);
    });

    it("keeps an unapproved first hop rejected when the chain returns to the manifest with 200", () => {
      const events = [
        request("17", MANIFEST_URL),
        request("17", "https://elsewhere.example/login", "Manifest", {
          url: MANIFEST_URL,
          status: 302,
          headers: { location: "https://elsewhere.example/login" },
        }),
        request("17", MANIFEST_URL),
        response("17", MANIFEST_URL, 200),
      ];

      const verdict = manifestVerdict(events);

      expect(verdict.accepted).toBe(false);
      expect(describeManifestVerdict(verdict)).toBe("HTTP 302 -> https://elsewhere.example/login");
    });

    it("rejects a non-200, non-302 manifest response", () => {
      const verdict = manifestVerdict([request("15", MANIFEST_URL), response("15", MANIFEST_URL, 404, "text/html")]);

      expect(verdict.accepted).toBe(false);
      expect(describeManifestVerdict(verdict)).toBe("HTTP 404 (text/html)");
    });

    it("rejects an empty event stream", () => {
      const verdict = manifestVerdict([]);

      expect(verdict.accepted).toBe(false);
      expect(verdict.requestCount).toBe(0);
      expect(describeManifestVerdict(verdict)).toContain("no GET /manifest.webmanifest");
    });

    it("rejects a loading failure while the manifest is still the current URL", () => {
      const verdict = manifestVerdict([request("16", MANIFEST_URL), failed("16", "net::ERR_CONNECTION_RESET")]);

      expect(verdict.accepted).toBe(false);
      expect(describeManifestVerdict(verdict)).toBe("network failure net::ERR_CONNECTION_RESET");
    });
  });

  describe("Access login destination shape", () => {
    it("accepts the host-scoped Access login URL on the configured tenant and strips its query", () => {
      expect(
        parseAccessLoginDestination(`${LOGIN_URL}?redirect_url=/manifest.webmanifest`, {
          stagingUrl: STAGING_URL,
          accessLoginOrigin: ACCESS_LOGIN_ORIGIN,
        }),
      ).toEqual({ loginUrl: LOGIN_URL, loginHost: "qa-team.cloudflareaccess.com" });
    });

    it("rejects plaintext, an unrelated host, another tenant, and an unconfigured tenant root", () => {
      const opts = { stagingUrl: STAGING_URL, accessLoginOrigin: ACCESS_LOGIN_ORIGIN };
      expect(
        parseAccessLoginDestination("http://qa-team.cloudflareaccess.com/cdn-cgi/access/login/staging.cafemood.app", opts),
      ).toBeNull();
      expect(
        parseAccessLoginDestination("https://qa-team.cloudflareaccess.com/cdn-cgi/access/login/other.example", opts),
      ).toBeNull();
      expect(parseAccessLoginDestination(OTHER_LOGIN, opts)).toBeNull();
      expect(parseAccessLoginDestination("https://qa-team.cloudflareaccess.com/", opts)).toBeNull();
    });

    it("normalizes the configured origin and fails closed on anything but a bare https origin", () => {
      expect(normalizeAccessLoginOrigin("https://QA-Team.cloudflareaccess.com/")).toBe(ACCESS_LOGIN_ORIGIN);
      expect(() => normalizeAccessLoginOrigin(undefined)).toThrow(MANIFEST_UNVERIFIED_SIGNATURE);
      expect(() => normalizeAccessLoginOrigin(`${ACCESS_LOGIN_ORIGIN}/cdn-cgi/access/login/x`)).toThrow(
        MANIFEST_UNVERIFIED_SIGNATURE,
      );
      expect(() => normalizeAccessLoginOrigin("http://qa-team.cloudflareaccess.com")).toThrow(MANIFEST_UNVERIFIED_SIGNATURE);
    });

    it("stripQuery keeps origin and path only", () => {
      expect(stripQuery(`${LOGIN_URL}?redirect_url=/x#fragment`)).toBe(LOGIN_URL);
    });
  });

  describe("captureManifestResponse", () => {
    it("drains stale events, navigates / on the staging origin, and returns the accepted verdict", async () => {
      const { page, calls, navigations } = fakePage([
        [],
        [
          request("20", MANIFEST_URL),
          request("20", LOGIN_URL, "Manifest", {
            url: MANIFEST_URL,
            status: 302,
            headers: { location: `${LOGIN_URL}?redirect_url=/manifest.webmanifest` },
          }),
        ],
      ]);

      const verdict = await captureManifestResponse(page, { stagingUrl: STAGING_URL, accessLoginOrigin: ACCESS_LOGIN_ORIGIN, timeoutMs: 500, pollMs: 0 });

      expect(verdict.accepted).toBe(true);
      expect(verdict.accessLoginUrl).toBe(LOGIN_URL);
      expect(navigations).toEqual(["https://staging.cafemood.app/"]);
      expect(calls[0].method).toBe("Network.enable");
    });

    it("throws the run-log signature when the browser observed no accepted response", async () => {
      const { page } = fakePage([[], [request("21", MANIFEST_URL)]]);

      const error = await captureManifestResponse(page, { stagingUrl: STAGING_URL, accessLoginOrigin: ACCESS_LOGIN_ORIGIN, timeoutMs: 0, pollMs: 0 }).then(
        () => null,
        (reason: Error) => reason,
      );

      expect(error?.message).toContain(MANIFEST_UNVERIFIED_SIGNATURE);
      expect(error?.message).toContain(MANIFEST_URL);
      expect(error?.message).toContain("no HTTP response");
    });

    it("throws the run-log signature when the document navigation never completes", async () => {
      const { page } = fakePage([], { gotoError: "Timeout 10000ms exceeded" });

      const error = await captureManifestResponse(page, { stagingUrl: STAGING_URL, accessLoginOrigin: ACCESS_LOGIN_ORIGIN, timeoutMs: 1000 }).then(
        () => null,
        (reason: Error) => reason,
      );

      expect(error?.message).toContain(MANIFEST_UNVERIFIED_SIGNATURE);
      expect(error?.message).toContain("could not open https://staging.cafemood.app/");
      expect(error?.message).toContain("Timeout 10000ms exceeded");
    });

    it("refuses a non-staging origin before touching the browser", async () => {
      const { page, calls } = fakePage([]);

      await expect(
        captureManifestResponse(page, {
          stagingUrl: "https://staging.example/api/health",
          accessLoginOrigin: ACCESS_LOGIN_ORIGIN,
          timeoutMs: 0,
        }),
      ).rejects.toThrow(/refused origin/);
      expect(calls).toEqual([]);
    });

    it("fails closed before touching the browser when the Access login origin is missing", async () => {
      const { page, calls } = fakePage([]);

      await expect(
        captureManifestResponse(page, { stagingUrl: STAGING_URL, accessLoginOrigin: undefined }),
      ).rejects.toThrow(/accessLoginOrigin must be the https origin/);
      expect(calls).toEqual([]);
    });

    it("keeps a rejected destination's query out of the failure message", async () => {
      const { page } = fakePage([
        [],
        [
          request("22", MANIFEST_URL),
          request("22", "https://elsewhere.example/login?token=sentinel", "Manifest", {
            url: MANIFEST_URL,
            status: 302,
            headers: { location: "https://elsewhere.example/login?token=sentinel" },
          }),
        ],
      ]);

      const error = await captureManifestResponse(page, { stagingUrl: STAGING_URL, accessLoginOrigin: ACCESS_LOGIN_ORIGIN, timeoutMs: 0, pollMs: 0 }).then(
        () => null,
        (reason: Error) => reason,
      );

      expect(error?.message).toContain("https://elsewhere.example/login");
      expect(error?.message).not.toContain("sentinel");
    });
  });
});
