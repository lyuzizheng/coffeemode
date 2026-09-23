import { describe, expect, it } from "vitest";

// Static import: impossible — importing the script runs its R2 credential
// validation at module top level, so each case re-imports it with a fresh
// query string AFTER installing a stub client via __setClientFactory.

/**
 * Regression tests for the BRAWUKA-592 re-review findings on
 * `image-service/scripts/clean-orphan-originals.mjs`:
 *
 * - P0: a non-200 HEAD (vanished object, transient 403/5xx, or a
 *   `redirect:"manual"` 3xx) must skip the candidate — never delete on
 *   uncertain state (BRAWUKA-400 invariant).
 * - P2: hitting the MAX_OBJECTS scan budget on a `continue` path (young,
 *   NaN-dated, failed HEAD) must still report `truncated:true` when the
 *   listing has an unprocessed tail.
 */

const SCRIPT = "../scripts/clean-orphan-originals.mjs";

interface Listed {
  orphans: Array<{ key: string }>;
  protectedRefs: Array<{ key: string }>;
  truncated: boolean;
}

function listXml(keys: Array<{ key: string; lastModified: string }>, truncated: boolean): string {
  const bodies = keys
    .map((k) => `<Contents><Key>${k.key}</Key><LastModified>${k.lastModified}</LastModified></Contents>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
    bodies +
    `<IsTruncated>${truncated ? "true" : "false"}</IsTruncated>` +
    `</ListBucketResult>`
  );
}

function headResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

/** Drive the script's listing with a stubbed network boundary. */
async function runList(opts: {
  listPages: string[];
  head: (url: string) => Response | Promise<Response>;
  maxKeys?: number;
  cutoffMs?: number;
  liveKeys?: Set<string> | null;
}): Promise<Listed> {
  const pages = [...opts.listPages];
  const stubFetch = async (url: string, init?: { method?: string }): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.includes("list-type=2")) {
      const body = pages.shift() ?? listXml([], false);
      return new Response(body, { status: 200 });
    }
    return opts.head(url);
  };
  // Fresh module per case (query string busts the import cache) so stubs
  // never leak between cases.
  const mod = await import(`${SCRIPT}?harness=${Date.now()}-${Math.random()}`);
  mod.__setClientFactory(() => ({ fetch: stubFetch }));
  try {
    return (await mod.__testList({
      maxKeys: opts.maxKeys ?? 100,
      cutoffMs: opts.cutoffMs ?? Date.now(),
      liveKeys: opts.liveKeys ?? null,
    })) as Listed;
  } finally {
    mod.__setClientFactory(null);
  }
}

describe("clean-orphan-originals listing (BRAWUKA-592 re-review)", () => {
  it("P0: a 500 HEAD skips the candidate instead of deleting it", async () => {
    const key = "original/abandoned.webp";
    const { orphans, protectedRefs } = await runList({
      listPages: [listXml([{ key, lastModified: "2020-01-01T00:00:00.000Z" }], false)],
      head: () => headResponse(500),
    });
    expect(orphans).toEqual([]);
    expect(protectedRefs).toEqual([]);
  });

  it("P0: a 403 HEAD on a live original is not classified as markerless", async () => {
    const key = "original/live.webp";
    const { orphans } = await runList({
      listPages: [listXml([{ key, lastModified: "2020-01-01T00:00:00.000Z" }], false)],
      // Transient auth error on a live gallery original: headers carry no
      // marker. Pre-guard code read targetType=null → "markerless" orphan.
      head: () => headResponse(403),
    });
    expect(orphans.map((o) => o.key)).not.toContain(key);
  });

  it("P2: budget hit on a young entry still reports truncation when a tail remains", async () => {
    const young = "original/young.webp";
    const { orphans, truncated } = await runList({
      // maxKeys=1 consumed by one young entry (continue path); the listing
      // still has a second page.
      listPages: [listXml([{ key: young, lastModified: new Date().toISOString() }], true)],
      head: () => headResponse(200),
      maxKeys: 1,
      cutoffMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    expect(orphans).toEqual([]);
    expect(truncated).toBe(true);
  });

  it("P2: no truncation when the budget exactly covers the final page", async () => {
    const { truncated } = await runList({
      listPages: [listXml([{ key: "original/only.webp", lastModified: new Date().toISOString() }], false)],
      head: () => headResponse(200),
      maxKeys: 1,
      cutoffMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    expect(truncated).toBe(false);
  });
});
