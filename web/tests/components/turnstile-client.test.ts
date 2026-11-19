import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  executeWidgetForToken,
  renderInvisibleResolveWidget,
  TURNSTILE_ACTION_PLACES_RESOLVE,
} from "@/lib/security/turnstile-client";

/**
 * Render-options contract for the places-resolve widget (BRAWUKA-1021).
 *
 * Turnstile rejects `size: "invisible"` — legal sizes are `normal`,
 * `flexible`, `compact`; invisibility comes from `appearance:
 * "interaction-only"`. These assertions fail if the illegal value comes back,
 * even after the TypeScript union is widened.
 */

interface RenderedWidgetOptions {
  sitekey: string;
  action: string;
  size: string;
  appearance: string;
  execution: string;
  theme: string;
  callback: (token: string) => void;
  [key: string]: unknown;
}

interface TurnstileStub {
  render: Mock<(container: HTMLElement, options: RenderedWidgetOptions) => string>;
  execute: Mock<(widgetId?: string) => void>;
}

/** jsdom has no Turnstile global; one named cast is the test boundary. */
function turnstileGlobal(): { turnstile?: unknown } {
  return window as unknown as { turnstile?: unknown };
}

function installTurnstile(): TurnstileStub {
  const render = vi.fn<(container: HTMLElement, options: RenderedWidgetOptions) => string>(
    () => "widget-1",
  );
  const execute = vi.fn<(widgetId?: string) => void>();
  turnstileGlobal().turnstile = { render, execute, reset: vi.fn(), remove: vi.fn() };
  return { render, execute };
}

afterEach(() => {
  delete turnstileGlobal().turnstile;
});

describe("turnstile-client widget render options", () => {
  it("renders with a size Turnstile accepts, never the removed invisible size", async () => {
    const { render } = installTurnstile();
    const container = document.createElement("div");

    await expect(renderInvisibleResolveWidget(container, "site-key")).resolves.toBe("widget-1");

    const [target, options] = render.mock.calls[0];
    expect(target).toBe(container);
    expect(["normal", "compact", "flexible"]).toContain(options.size);
    expect(options).toMatchObject({
      sitekey: "site-key",
      action: TURNSTILE_ACTION_PLACES_RESOLVE,
      size: "flexible",
      appearance: "interaction-only",
      execution: "execute",
      theme: "auto",
    });
  });

  it("execute() resolves the pending submit with the callback token", async () => {
    const { render, execute } = installTurnstile();
    const widgetId = await renderInvisibleResolveWidget(document.createElement("div"), "site-key");

    const tokenPromise = executeWidgetForToken(widgetId, 1_000);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith(widgetId));
    render.mock.calls[0][1].callback("tok-123");

    await expect(tokenPromise).resolves.toBe("tok-123");
  });

  it("rejects a second execute for the same widget while one challenge is pending", async () => {
    const { render, execute } = installTurnstile();
    const widgetId = await renderInvisibleResolveWidget(document.createElement("div"), "site-key");

    const first = executeWidgetForToken(widgetId, 1_000);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    await expect(executeWidgetForToken(widgetId, 1_000)).rejects.toThrow(/already in progress/);
    render.mock.calls[0][1].callback("tok-123");

    await expect(first).resolves.toBe("tok-123");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
