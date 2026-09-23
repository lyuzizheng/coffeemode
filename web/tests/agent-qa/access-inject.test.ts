import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_FETCH_RESOURCE_TYPES,
  buildAccessFetchPatterns,
  createAccessRequestPump,
  handlePausedAccessRequest,
  loadAccessEnvFile,
  mergeAccessHeaders,
  parseAccessEnvText,
  shouldAttachAccessHeaders,
} from "../../../scripts/agent-qa/access-inject.mjs";
import { AGENT_QA_ACCESS_HOSTS } from "../../../scripts/agent-qa/allowlist.mjs";

const PAIR = { clientId: "id-1", clientSecret: "secret-1" };

function pausedEvent(url: string, headers: Record<string, string> = {}) {
  return {
    method: "Fetch.requestPaused",
    params: { requestId: "req-1", request: { url, headers } },
  };
}

describe("buildAccessFetchPatterns", () => {
  it("emits one Request-stage subresource pattern per Access host, never Document or catch-all", () => {
    const patterns = buildAccessFetchPatterns();
    expect(patterns).toHaveLength(
      AGENT_QA_ACCESS_HOSTS.length * ACCESS_FETCH_RESOURCE_TYPES.length,
    );
    expect(ACCESS_FETCH_RESOURCE_TYPES).not.toContain("Document");
    expect(new Set(ACCESS_FETCH_RESOURCE_TYPES).size).toBe(ACCESS_FETCH_RESOURCE_TYPES.length);
    for (const pattern of patterns) {
      expect(pattern.requestStage).toBe("Request");
      expect(pattern.urlPattern.startsWith("*://")).toBe(true);
      expect(pattern.urlPattern.endsWith("/*")).toBe(true);
      expect(pattern.resourceType).not.toBe("Document");
      expect(ACCESS_FETCH_RESOURCE_TYPES).toContain(pattern.resourceType);
    }
    expect(patterns.map((p) => p.urlPattern)).toContain("*://staging.cafemood.app/*");
    expect(patterns.some((p) => p.urlPattern.includes("supabase.co"))).toBe(false);
    expect(patterns.some((p) => p.resourceType === "XHR")).toBe(true);
    expect(patterns.some((p) => p.urlPattern.includes("*") && !p.urlPattern.startsWith("*://"))).toBe(
      false,
    );
  });

  it("never emits a pattern for the staging Supabase host (BRAWUKA-593)", () => {
    const patterns = buildAccessFetchPatterns();
    expect(
      patterns.some((p) => p.urlPattern.includes("ojujmjewtbquiddswyrg.supabase.co")),
    ).toBe(false);
  });
});

describe("shouldAttachAccessHeaders", () => {
  it("attaches only to http(s) URLs on Access-protected hosts", () => {
    expect(shouldAttachAccessHeaders("https://staging.cafemood.app/discover")).toBe(true);
    expect(shouldAttachAccessHeaders("https://foo.cloudflareaccess.com/x")).toBe(true);
    expect(shouldAttachAccessHeaders("https://ojujmjewtbquiddswyrg.supabase.co/auth/v1/token")).toBe(false);
  });

  it("refuses third-party, non-http, and malformed URLs (fail-closed)", () => {
    expect(shouldAttachAccessHeaders("https://cloudflareinsights.com/beacon")).toBe(false);
    expect(shouldAttachAccessHeaders("https://tiles.openfreemap.org/x")).toBe(false);
    expect(shouldAttachAccessHeaders("https://staging.cafemood.app.evil.com/")).toBe(false);
    expect(shouldAttachAccessHeaders("ftp://staging.cafemood.app/x")).toBe(false);
    expect(shouldAttachAccessHeaders("not a url")).toBe(false);
    expect(shouldAttachAccessHeaders(null)).toBe(false);
  });
});

describe("mergeAccessHeaders", () => {
  it("adds the token pair while preserving other headers in order", () => {
    expect(mergeAccessHeaders({ "x-a": "1", "content-type": "text/html" }, PAIR)).toEqual([
      { name: "x-a", value: "1" },
      { name: "content-type", value: "text/html" },
      { name: "CF-Access-Client-Id", value: "id-1" },
      { name: "CF-Access-Client-Secret", value: "secret-1" },
    ]);
  });

  it("replaces stale Access values and never mutates the input", () => {
    const original = { "CF-Access-Client-Id": "old", "cf-access-client-secret": "old" };
    const merged = mergeAccessHeaders(original, PAIR);
    expect(merged.filter((h) => h.name.toLowerCase().startsWith("cf-access-"))).toEqual([
      { name: "CF-Access-Client-Id", value: "id-1" },
      { name: "CF-Access-Client-Secret", value: "secret-1" },
    ]);
    expect(original).toEqual({ "CF-Access-Client-Id": "old", "cf-access-client-secret": "old" });
    expect(mergeAccessHeaders(undefined, PAIR)).toHaveLength(2);
  });
});

describe("handlePausedAccessRequest", () => {
  it("attaches headers to Access-protected requests, passes third-party through untouched", async () => {
    const cdp = vi.fn().mockResolvedValue({});
    const page = { cdp };
    expect(await handlePausedAccessRequest(page, pausedEvent("https://staging.cafemood.app/x", { "x-a": "1" }), PAIR)).toBe(
      "attached",
    );
    expect(cdp).toHaveBeenCalledWith(
      "Fetch.continueRequest",
      expect.objectContaining({
        requestId: "req-1",
        headers: expect.arrayContaining([
          { name: "CF-Access-Client-Id", value: "id-1" },
          { name: "CF-Access-Client-Secret", value: "secret-1" },
        ]),
      }),
    );
    cdp.mockClear();
    expect(
      await handlePausedAccessRequest(
        page,
        pausedEvent("https://ojujmjewtbquiddswyrg.supabase.co/auth/v1/token"),
        PAIR,
      ),
    ).toBe("passthrough");
    expect(cdp).toHaveBeenCalledWith("Fetch.continueRequest", { requestId: "req-1" });
    cdp.mockClear();
    expect(
      await handlePausedAccessRequest(page, pausedEvent("https://cloudflareinsights.com/beacon"), PAIR),
    ).toBe("passthrough");
    expect(cdp).toHaveBeenCalledWith("Fetch.continueRequest", { requestId: "req-1" });
    const sent = cdp.mock.calls[0][1] as Record<string, unknown>;
    expect("headers" in sent).toBe(false);
  });

  it("never throws: a paused request is always continued", async () => {
    const page = { cdp: vi.fn().mockRejectedValue(new Error("gone")) };
    await expect(
      handlePausedAccessRequest(page, pausedEvent("https://staging.cafemood.app/x"), PAIR),
    ).resolves.toBe("attached");
    const badPage = { cdp: vi.fn() };
    await expect(handlePausedAccessRequest(badPage, { method: "other" }, PAIR)).resolves.toBe(
      "passthrough",
    );
    expect(badPage.cdp).not.toHaveBeenCalled();
  });
});

describe("createAccessRequestPump", () => {
  it("routes paused events and ignores everything else", async () => {
    vi.useFakeTimers();
    try {
      const cdp = vi.fn().mockResolvedValue({});
      const events = vi
        .fn()
        .mockResolvedValueOnce([
          { method: "Network.dataReceived" },
          pausedEvent("https://staging.cafemood.app/x"),
          pausedEvent("https://tiles.openfreemap.org/tile"),
        ])
        .mockResolvedValue([]);
      const stop = createAccessRequestPump(PAIR, { intervalMs: 10 }).start({
        events,
        cdp,
      } as unknown as { events: () => Promise<unknown[]>; cdp: (m: string, p?: unknown) => Promise<unknown> });
      await vi.advanceTimersByTimeAsync(50);
      stop();
      const calls = cdp.mock.calls.map((call) => call[1]) as Array<Record<string, unknown>>;
      expect(calls).toHaveLength(2);
      expect((calls[0].headers as Array<{ name: string }>)?.some((h) => h.name.startsWith("CF-Access-"))).toBe(
        true,
      );
      expect(calls[1]).toEqual({ requestId: "req-1" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("secret bridge (0600 file)", () => {
  it("parses KEY=VALUE lines, skipping comments and foreign keys", () => {
    expect(
      parseAccessEnvText(
        '# bridge\nCF_ACCESS_CLIENT_ID="id-1"\nCF_ACCESS_CLIENT_SECRET=secret-1\nOTHER=1\n',
      ),
    ).toEqual({ CF_ACCESS_CLIENT_ID: "id-1", CF_ACCESS_CLIENT_SECRET: "secret-1" });
    expect(parseAccessEnvText("")).toEqual({});
  });

  it("deletes the bridge file immediately, then fails closed on missing vars", async () => {
    const readFile = vi.fn().mockResolvedValue("CF_ACCESS_CLIENT_ID=id-1\n");
    const unlink = vi.fn().mockResolvedValue(undefined);
    await expect(loadAccessEnvFile("/tmp/bridge", { readFile, unlink })).rejects.toThrow(
      /CF_ACCESS_CLIENT_SECRET/,
    );
    expect(unlink).toHaveBeenCalledWith("/tmp/bridge");
    const full = { readFile: vi.fn().mockResolvedValue("CF_ACCESS_CLIENT_ID=id-1\nCF_ACCESS_CLIENT_SECRET=s\n"), unlink: vi.fn().mockResolvedValue(undefined) };
    await expect(loadAccessEnvFile("/tmp/bridge", full)).resolves.toEqual({
      clientId: "id-1",
      clientSecret: "s",
    });
  });
});
