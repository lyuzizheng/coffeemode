/**
 * Cloudflare Turnstile widget loader (BRAWUKA-239).
 *
 * Single script-tag loader + invisible-widget token flow for the
 * `places-resolve` surface in `CafePlaceSearch`. Tokens are single-use:
 * every submit executes a fresh challenge and the widget resets after each
 * attempt so a retry mints a new one. Client-safe by construction: no
 * `node:` imports, no `server-only` guard.
 */

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** Stable widget action, must match the siteverify `action` check server-side. */
export const TURNSTILE_ACTION_PLACES_RESOLVE = "places-resolve";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  // `execution: "execute"` keeps the invisible widget dormant at render so the
  // challenge only runs when `executeWidgetForToken` calls `execute()` per
  // submit. The default `"render"` would burn one challenge per mount whose
  // token is discarded (`pendingByWidget` is empty until submit).
  execution?: "render" | "execute";
  size?: "normal" | "compact" | "flexible" | "invisible";
  theme?: "light" | "dark" | "auto";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  execute(widgetId?: string): void;
}

interface TurnstileWindow extends Window {
  turnstile?: TurnstileApi;
  __coffeeModeTurnstileLoaded?: boolean;
}

/** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` mirrored by Next into the browser bundle. */
export function getTurnstileSiteKey(): string | null {
  const raw = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return raw ? raw : null;
}

/**
 * Load the Turnstile API script once per page (mirrors the MapKit loader in
 * `apple-place-search.tsx`). Resolves when `window.turnstile.render` is ready.
 */
export function loadTurnstileScript(): Promise<TurnstileApi> {
  const win = window as TurnstileWindow;
  if (win.turnstile?.render) return Promise.resolve(win.turnstile);

  const { promise, resolve, reject } = Promise.withResolvers<TurnstileApi>();
  const settleLoaded = () => {
    win.__coffeeModeTurnstileLoaded = true;
    if (win.turnstile?.render) resolve(win.turnstile);
    else reject(new Error("Turnstile script failed to initialize"));
  };

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
  if (existing) {
    if (win.__coffeeModeTurnstileLoaded && win.turnstile?.render) {
      resolve(win.turnstile);
      return promise;
    }
    existing.addEventListener("load", settleLoaded, { once: true });
    existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), { once: true });
    return promise;
  }

  const script = document.createElement("script");
  script.src = TURNSTILE_SCRIPT;
  script.async = true;
  script.defer = true;
  script.onload = settleLoaded;
  script.onerror = () => reject(new Error("Turnstile script failed to load"));
  document.head.appendChild(script);
  return promise;
}

/** In-flight `execute()` deferred, keyed by widget id. */
const pendingByWidget = new Map<string, { resolve: (token: string) => void; reject: (cause: Error) => void }>();

/**
 * Render the invisible `places-resolve` widget into `container`. The widget
 * stays dormant until `executeWidgetForToken` runs the challenge per submit.
 */
export async function renderInvisibleResolveWidget(container: HTMLElement, sitekey: string): Promise<string> {
  const turnstile = await loadTurnstileScript();
  let widgetId = "";
  widgetId = turnstile.render(container, {
    sitekey,
    action: TURNSTILE_ACTION_PLACES_RESOLVE,
    size: "invisible",
    execution: "execute",
    theme: "auto",
    callback: (token: string) => {
      pendingByWidget.get(widgetId)?.resolve(token);
    },
    "expired-callback": () => {
      pendingByWidget.get(widgetId)?.reject(new Error("Turnstile token expired"));
    },
    "error-callback": () => {
      pendingByWidget.get(widgetId)?.reject(new Error("Turnstile challenge failed"));
    },
  });
  return widgetId;
}

/**
 * Run the invisible challenge for one submit and resolve with the fresh
 * single-use token. Rejects on challenge failure or timeout — callers must
 * treat rejection as "do not submit" and reset before retrying.
 */
export async function executeWidgetForToken(widgetId: string, timeoutMs = 15_000): Promise<string> {
  const turnstile = await loadTurnstileScript();
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  pendingByWidget.set(widgetId, { resolve, reject });
  const timeout = setTimeout(() => {
    pendingByWidget.delete(widgetId);
    reject(new Error("Turnstile challenge timed out"));
  }, timeoutMs);
  try {
    turnstile.execute(widgetId);
    return await promise;
  } finally {
    clearTimeout(timeout);
    pendingByWidget.delete(widgetId);
  }
}

/** Reset the widget after an attempt so the next submit mints a fresh token. */
export async function resetResolveWidget(widgetId: string): Promise<void> {
  (await loadTurnstileScript()).reset(widgetId);
}

/** Remove the widget on unmount or surface switch. */
export function removeResolveWidget(widgetId: string): void {
  (window as TurnstileWindow).turnstile?.remove?.(widgetId);
}
