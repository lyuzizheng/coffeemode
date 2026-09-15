/**
 * @vitest-environment jsdom
 * Turnstile client loader/widget flow (BRAWUKA-239).
 *
 * Covers the single-use token contract the route depends on: render the
 * invisible widget once, execute per submit for a fresh token, reject on
 * challenge failure/timeout, and reset/remove across attempts. `window` and
 * `document` access is jsdom; the Turnstile API itself is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_ACTION_PLACES_RESOLVE,
  TURNSTILE_SCRIPT,
  executeWidgetForToken,
  getTurnstileSiteKey,
  loadTurnstileScript,
  removeResolveWidget,
  renderInvisibleResolveWidget,
  resetResolveWidget,
} from "@/lib/security/turnstile-client";

interface StubTurnstile {
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

function stubApi(): StubTurnstile {
  const api: StubTurnstile = {
    render: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
    execute: vi.fn(),
  };
  (window as unknown as { turnstile: StubTurnstile }).turnstile = api;
  return api;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (window as unknown as { turnstile?: StubTurnstile }).turnstile;
  delete (window as unknown as { __coffeeModeTurnstileLoaded?: boolean }).__coffeeModeTurnstileLoaded;
  for (const script of document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT}"]`)) {
    script.remove();
  }
});

describe("getTurnstileSiteKey", () => {
  it("returns the configured sitekey and null when blank", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  0x4AAAA-sitekey  ");
    expect(getTurnstileSiteKey()).toBe("0x4AAAA-sitekey");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "   ");
    expect(getTurnstileSiteKey()).toBeNull();
  });
});

describe("loadTurnstileScript", () => {
  it("resolves immediately when the API is already present", async () => {
    const api = stubApi();
    await expect(loadTurnstileScript()).resolves.toBe(api);
    expect(document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT}"]`)).toHaveLength(0);
  });

  it("appends the script tag and resolves on load", async () => {
    const loadPromise = loadTurnstileScript();
    const script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    expect(script).not.toBeNull();
    const api = stubApi();
    script?.dispatchEvent(new Event("load"));
    await expect(loadPromise).resolves.toBe(api);
  });

  it("rejects when the script fails to load", async () => {
    const loadPromise = loadTurnstileScript();
    const script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    script?.dispatchEvent(new Event("error"));
    await expect(loadPromise).rejects.toThrow("failed to load");
  });

  it("attaches to an in-flight script tag placed by another surface", async () => {
    const pending = document.createElement("script");
    pending.src = TURNSTILE_SCRIPT;
    document.head.appendChild(pending);
    const loadPromise = loadTurnstileScript();
    const api = stubApi();
    pending.dispatchEvent(new Event("load"));
    await expect(loadPromise).resolves.toBe(api);
  });
});

describe("invisible widget token flow", () => {
  it("renders once with the places-resolve action and resolves a fresh token per execute", async () => {
    const api = stubApi();
    api.render.mockImplementation((_container: HTMLElement, options: { callback?: (token: string) => void }) => {
      queueMicrotask(() => options.callback?.("fresh-token"));
      return "widget-1";
    });

    const container = document.createElement("div");
    const widgetId = await renderInvisibleResolveWidget(container, "sitekey");
    expect(widgetId).toBe("widget-1");
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(api.render.mock.calls[0]?.[1]).toMatchObject({
      sitekey: "sitekey",
      action: TURNSTILE_ACTION_PLACES_RESOLVE,
      size: "invisible",
    });

    api.execute.mockImplementation(() => {
      (window as unknown as { turnstile: StubTurnstile }).turnstile.render.mock.calls[0][1].callback?.("fresh-token");
    });
    await expect(executeWidgetForToken(widgetId)).resolves.toBe("fresh-token");
    expect(api.execute).toHaveBeenCalledWith("widget-1");

    await resetResolveWidget(widgetId);
    expect(api.reset).toHaveBeenCalledWith("widget-1");

    removeResolveWidget(widgetId);
    expect(api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("rejects the submit when the challenge errors", async () => {
    const api = stubApi();
    api.render.mockImplementation((_container: HTMLElement, options: { ["error-callback"]?: () => void }) => {
      queueMicrotask(() => options["error-callback"]?.());
      return "widget-err";
    });
    const widgetId = await renderInvisibleResolveWidget(document.createElement("div"), "sitekey");
    api.execute.mockImplementation(() => {});
    // Drive the error path through the registered callback captured at render.
    api.render.mock.calls[0][1]["error-callback"]?.();
    await expect(executeWidgetForToken(widgetId, 50)).rejects.toThrow();
  });

  it("rejects on challenge timeout so the submit never fires tokenless", async () => {
    stubApi().render.mockReturnValue("widget-hang");
    const widgetId = await renderInvisibleResolveWidget(document.createElement("div"), "sitekey");
    await expect(executeWidgetForToken(widgetId, 10)).rejects.toThrow("timed out");
  });
});
