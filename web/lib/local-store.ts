/**
 * Generic quota-safe localStorage store with event pub/sub and useSyncExternalStore
 * snapshot caching (spec 0009 §5 repeated-shape factory).
 */

export interface LocalStoreOptions<T> {
  /** The localStorage key */
  key: string;
  /** Fallback value returned when storage is empty, corrupted, or unavailable (e.g. SSR) */
  fallback: T;
  /** Custom window event dispatched on state changes (defaults to `${key}:changed`) */
  changeEvent?: string;
  /**
   * Optional validator and transformer for parsed JSON.
   * If parsing succeeds, `validate` is called with the raw parsed object.
   * If `validate` returns a valid T, that is returned. If it throws or fails,
   * the store degrades gracefully to `fallback`.
   */
  validate?: (parsed: unknown) => T;
}

export interface LocalStore<T> {
  /** Quota-safe read. Returns fallback on SSR, missing key, corrupt JSON, or validation failure. */
  get: () => T;
  /** Quota-safe write. Serializes to JSON, stores to localStorage, and dispatches changeEvent. */
  set: (value: T) => void;
  /** Quota-safe removal. Removes key from localStorage and dispatches changeEvent. */
  remove: () => void;
  /**
   * Subscribes to store changes. Listens to both the custom window event (same-tab)
   * and the native `storage` event (cross-tab sync). Returns an unsubscribe function.
   */
  subscribe: (callback: () => void) => () => void;
  /**
   * Snapshot reader for React's `useSyncExternalStore`.
   * Caches the parsed snapshot across renders so reference identity remains stable
   * unless the underlying raw localStorage string changes.
   */
  getSnapshot: () => T;
  /**
   * Server snapshot reader for React's `useSyncExternalStore`. Always returns `fallback`.
   */
  getServerSnapshot: () => T;
}

const UNSET = Symbol("unset");

function safeWrite(key: string, value: unknown, changeEvent: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(changeEvent));
  } catch {
    // Ignore localStorage write failures (e.g. quota or private mode)
  }
}

function safeRemove(key: string, changeEvent: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
    window.dispatchEvent(new Event(changeEvent));
  } catch {
    // Benign: localStorage removeItem failure in private mode is ignored.
  }
}

function subscribeStorage(key: string, changeEvent: string, callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) {
      callback();
    }
  };
  window.addEventListener(changeEvent, callback);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, callback);
    window.removeEventListener("storage", handleStorage);
  };
}

export function createLocalStore<T>(options: LocalStoreOptions<T>): LocalStore<T> {
  const { key, fallback, validate } = options;
  const changeEvent = options.changeEvent ?? `${key}:changed`;

  let cachedRaw: string | null | typeof UNSET = UNSET;
  let cachedValue: T = fallback;

  function get(): T {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw) as unknown;
      return validate ? validate(parsed) : ((parsed ?? fallback) as T);
    } catch {
      // Benign: corrupted JSON, validation error, or blocked storage access degrades to fallback.
      return fallback;
    }
  }

  function getSnapshot(): T {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === cachedRaw) return cachedValue;
      cachedRaw = raw;
      cachedValue = get();
      return cachedValue;
    } catch {
      // Benign: localStorage read failure degrades snapshot to fallback.
      return fallback;
    }
  }

  return {
    get,
    set: (value: T) => safeWrite(key, value, changeEvent),
    remove: () => safeRemove(key, changeEvent),
    subscribe: (callback: () => void) => subscribeStorage(key, changeEvent, callback),
    getSnapshot,
    getServerSnapshot: () => fallback,
  };
}
