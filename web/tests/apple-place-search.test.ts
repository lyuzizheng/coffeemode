/**
 * @vitest-environment jsdom
 * Apple provider session-expiry contract (BRAWUKA-296, BRAWUKA-353).
 *
 * `GET /api/mapkit-token` is auth-gated, so a dead session on the token
 * fetch must surface as the shared `unauthorized` marker — the same signal
 * the creation drawer routes to its sign-in gate (BRAWUKA-212) — not as a
 * "not configured" error. `window.mapkit` is stubbed; only the token fetch
 * is real. BRAWUKA-353 extends this to MapKit's own re-auth: a 401 inside
 * `authorizationCallback` must latch the marker so in-flight and later
 * searches reject `unauthorized` instead of a generic `searchFailed`.
 */
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { applePlaceSearch, loadMapKitScript, _resetMapKitStateForTests } from "@/lib/places/apple-place-search";
import type { CreateTranslator } from "@/lib/places/place-search";
import { isUnauthorized } from "@/lib/http";

// Test-only translator stub: providers only call `t(key)` for labels.
const stubTranslator = ((key: string) => key) as unknown as CreateTranslator;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // MapKit init state and injected scripts are page-global; reset per test.
  Reflect.deleteProperty(window, "__coffeeModeMapKitInitialized");
  document.head.innerHTML = "";
  _resetMapKitStateForTests();
});

type SearchCallback = (error: unknown, response?: { places?: unknown[] }) => void;

interface MapKitStub {
  /** The `done` the provider hands results to; records the token MapKit got. */
  done: Mock<(token: string) => void>;
  /** Replays MapKit's re-auth: invokes the captured authorizationCallback. */
  reauthorize: () => void;
  /** Completes the pending search the way MapKit does after a failed auth. */
  failSearch: (error: unknown) => void;
  searchCalls: number;
}

/**
 * Pre-seed a "loaded" MapKit script tag (jsdom never fires script onload) and
 * a `window.mapkit` stub that captures the authorization callback so tests can
 * drive re-auth round-trips the way the real SDK does.
 */
function stubMapKit(): MapKitStub {
  const script = document.createElement("script");
  script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
  script.dataset.loaded = "true";
  document.head.appendChild(script);

  let authorizationCallback: ((done: (token: string) => void) => void) | undefined;
  let searchCallback: SearchCallback | undefined;
  const stub: MapKitStub = {
    done: vi.fn(),
    reauthorize: () => authorizationCallback?.(stub.done),
    failSearch: (error) => searchCallback?.(error),
    searchCalls: 0,
  };
  vi.stubGlobal("mapkit", {
    init: vi.fn((options: { authorizationCallback: (done: (token: string) => void) => void }) => {
      // Capture only: init()'s own token fetch covers first authorization;
      // tests drive later re-auth round-trips via stub.reauthorize().
      authorizationCallback = options.authorizationCallback;
    }),
    Search: class {
      search(_query: string, callback: SearchCallback) {
        stub.searchCalls += 1;
        searchCallback = callback;
      }
    },
  });
  return stub;
}

describe("applePlaceSearch init (BRAWUKA-296)", () => {
  it("rejects with the unauthorized marker when the token fetch is 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })),
    );
    await expect(applePlaceSearch(stubTranslator).init?.()).rejects.toSatisfy(isUnauthorized);
  });

  it("rejects with a not-configured error when the token fetch fails otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"mapkit_not_configured"}', { status: 503 })),
    );
    await expect(applePlaceSearch(stubTranslator).init?.()).rejects.toThrow("MapKit is not configured");
  });
});

describe("applePlaceSearch MapKit re-auth (BRAWUKA-353)", () => {
  it("rejects an in-flight search with the unauthorized marker when re-auth is 401", async () => {
    const stub = stubMapKit();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"token":"t0"}', { status: 200 }))
        .mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })),
    );
    const provider = applePlaceSearch(stubTranslator);
    await provider.init?.();

    const inFlight = provider.search("blue bottle");
    const assertion = expect(inFlight).rejects.toSatisfy(isUnauthorized);
    // Session dies mid-search: MapKit re-auths, our token endpoint says 401.
    // The search must reject unauthorized even though MapKit never calls back.
    stub.reauthorize();
    await assertion;
    // MapKit still receives the empty-token failure it tolerates.
    await vi.waitFor(() => expect(stub.done).toHaveBeenCalledWith(""));
    // The latch also short-circuits the next search before MapKit is asked.
    await expect(provider.search("blue bottle")).rejects.toSatisfy(isUnauthorized);
    expect(stub.searchCalls).toBe(1);
  });

  it("keeps generic searchFailed when re-auth fails for a non-401 reason", async () => {
    const stub = stubMapKit();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"token":"t0"}', { status: 200 }))
        .mockResolvedValue(new Response('{"error":"upstream_error"}', { status: 503 })),
    );
    const provider = applePlaceSearch(stubTranslator);
    await provider.init?.();

    const inFlight = provider.search("blue bottle");
    const assertion = expect(inFlight).rejects.toThrow("searchFailed");
    stub.reauthorize();
    await vi.waitFor(() => expect(stub.done).toHaveBeenCalledWith(""));
    // MapKit reports the failed authorization to the pending search.
    stub.failSearch(new Error("AUTHORIZATION_FAILED"));
    await assertion;
    // No latch: the next search still reaches MapKit.
    void provider.search("blue bottle").catch(() => {});
    expect(stub.searchCalls).toBe(2);
  });
});

describe("applePlaceSearch script load resilience (BRAWUKA-404)", () => {
  it("removes dead script and rejects on script load failure, and succeeds on retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response('{"token":"t0"}', { status: 200 }))),
    );

    const provider = applePlaceSearch(stubTranslator);

    // First attempt: script fails to load
    const firstInit = provider.init?.();
    await vi.waitFor(() => {
      const script = document.querySelector<HTMLScriptElement>(
        'script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]',
      );
      expect(script).not.toBeNull();
    });

    const script1 = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]',
    )!;
    script1.dispatchEvent(new Event("error"));

    await expect(firstInit).rejects.toThrow("MapKit script failed to load");

    // Dead script element should be removed from DOM
    expect(
      document.querySelector('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]'),
    ).toBeNull();

    // Second attempt (retry): stub mapkit and trigger success
    const mapkitMock = {
      init: vi.fn(),
      Search: class {},
    };
    vi.stubGlobal("mapkit", mapkitMock);

    const secondInit = provider.init?.();
    await vi.waitFor(() => {
      const script = document.querySelector<HTMLScriptElement>(
        'script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]',
      );
      expect(script).not.toBeNull();
    });

    const script2 = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]',
    )!;
    expect(script2).not.toBe(script1);
    script2.dispatchEvent(new Event("load"));

    await expect(secondInit).resolves.toBeUndefined();
    expect(mapkitMock.init).toHaveBeenCalled();
    expect(script2.dataset.loaded).toBe("true");
  });

  it("rejects in finite time on repeated script failure without pending indefinitely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response('{"token":"t0"}', { status: 200 }))),
    );

    const provider = applePlaceSearch(stubTranslator);

    // First failure
    const firstInit = provider.init?.();
    await vi.waitFor(() => {
      expect(
        document.querySelector('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]'),
      ).not.toBeNull();
    });
    document
      .querySelector<HTMLScriptElement>('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]')!
      .dispatchEvent(new Event("error"));
    await expect(firstInit).rejects.toThrow("MapKit script failed to load");

    // Second failure on retry
    const secondInit = provider.init?.();
    await vi.waitFor(() => {
      expect(
        document.querySelector('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]'),
      ).not.toBeNull();
    });
    document
      .querySelector<HTMLScriptElement>('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]')!
      .dispatchEvent(new Event("error"));
    await expect(secondInit).rejects.toThrow("MapKit script failed to load");

    expect(
      document.querySelector('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]'),
    ).toBeNull();
  });

  it("times out and cleans up when script load stalls", async () => {
    const promise = loadMapKitScript(50);
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]',
    );
    expect(script).not.toBeNull();

    await expect(promise).rejects.toThrow("MapKit script load timed out");
    expect(
      document.querySelector('script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]'),
    ).toBeNull();
  });

  it("cleans up a pre-existing failed script element on subsequent load attempt", async () => {
    const deadScript = document.createElement("script");
    deadScript.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    deadScript.dataset.failed = "true";
    document.head.appendChild(deadScript);

    const loadPromise = loadMapKitScript();
    // Dead script should have been removed
    expect(deadScript.parentElement).toBeNull();

    const newScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js"]',
    )!;
    expect(newScript).not.toBe(deadScript);

    newScript.dispatchEvent(new Event("load"));
    await expect(loadPromise).resolves.toBeUndefined();
    expect(newScript.dataset.loaded).toBe("true");
  });
});

describe("applePlaceSearch in-flight search failure & latch resilience (BRAWUKA-404)", () => {
  it("rejects in-flight search on non-401 token refresh failure without waiting for MapKit callback", async () => {
    const stub = stubMapKit();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"token":"t0"}', { status: 200 }))
        .mockResolvedValue(new Response('{"error":"internal_error"}', { status: 500 })),
    );
    const provider = applePlaceSearch(stubTranslator);
    await provider.init?.();

    const inFlight = provider.search("latte");
    const assertion = expect(inFlight).rejects.toThrow("searchFailed");

    // Token refresh fails with 500
    stub.reauthorize();
    // In-flight search must reject immediately with searchFailed, without stub.failSearch() ever being called!
    await assertion;
    expect(stub.done).toHaveBeenCalledWith("");
  });

  it("does not clear a latched 401 session-expired state when a subsequent re-auth fails with non-401", async () => {
    const stub = stubMapKit();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"token":"t0"}', { status: 200 })) // init
        .mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 })) // 1st re-auth (401)
        .mockResolvedValueOnce(new Response('{"error":"server_down"}', { status: 503 })), // 2nd re-auth (503)
    );
    const provider = applePlaceSearch(stubTranslator);
    await provider.init?.();

    // Trigger 1st re-auth -> 401
    const search1 = provider.search("latte 1");
    stub.reauthorize();
    await expect(search1).rejects.toSatisfy(isUnauthorized);

    // Next search fails immediately due to latched 401
    await expect(provider.search("latte 2")).rejects.toSatisfy(isUnauthorized);

    // Trigger 2nd re-auth (e.g. MapKit tries again in background) -> 503
    stub.reauthorize();
    await vi.waitFor(() => expect(stub.done).toHaveBeenCalledWith(""));

    // The latched 401 MUST NOT be cleared by the 503 failure!
    await expect(provider.search("latte 3")).rejects.toSatisfy(isUnauthorized);
  });
});
