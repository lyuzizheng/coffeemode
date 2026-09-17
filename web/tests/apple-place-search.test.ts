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
import { applePlaceSearch } from "@/lib/places/apple-place-search";
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
