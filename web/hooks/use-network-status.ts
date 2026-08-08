"use client";

import { useSyncExternalStore } from "react";

const PING_INTERVAL_MS = 15000;
const PING_URL = "/api/health";

export type NetworkState = "online" | "offline" | "unknown";

type Listener = () => void;

interface NetworkStatusSnapshot {
  state: NetworkState;
  lastOnline: Date | null;
}

const SERVER_SNAPSHOT: NetworkStatusSnapshot = { state: "online", lastOnline: null };

class NetworkStatusStore {
  private snapshot: NetworkStatusSnapshot;
  private listeners = new Set<Listener>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private deferredPing: ReturnType<typeof setTimeout> | null = null;
  private pendingControllers = new Set<AbortController>();
  private mounted = false;
  private readonly handleOnline = () => this.setState("online");
  private readonly handleOffline = () => this.setState("offline");

  constructor() {
    const online = typeof navigator !== "undefined" && navigator.onLine;
    this.snapshot = {
      state: online ? "online" : "offline",
      lastOnline: online ? new Date() : null,
    };
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setState(next: NetworkState) {
    if (this.snapshot.state === next) return;
    this.snapshot = {
      state: next,
      lastOnline: next === "online" ? new Date() : this.snapshot.lastOnline,
    };
    this.emit();
  }

  private async ping() {
    if (typeof navigator === "undefined") return;

    if (!navigator.onLine) {
      this.setState("offline");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    this.pendingControllers.add(controller);

    try {
      const response = await fetch(PING_URL, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.setState(response.ok ? "online" : "offline");
    } catch {
      clearTimeout(timeout);
      this.setState("offline");
    } finally {
      this.pendingControllers.delete(controller);
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    if (!this.mounted) {
      this.mounted = true;
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
      // Defer the first ping so it does not run during render.
      this.deferredPing = setTimeout(() => void this.ping(), 0);
      this.interval = setInterval(() => void this.ping(), PING_INTERVAL_MS);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.mounted) {
        window.removeEventListener("online", this.handleOnline);
        window.removeEventListener("offline", this.handleOffline);
        if (this.interval) clearInterval(this.interval);
        if (this.deferredPing) clearTimeout(this.deferredPing);
        for (const c of this.pendingControllers) {
          c.abort();
        }
        this.pendingControllers.clear();
        this.mounted = false;
      }
    };
  }

  getSnapshot(): NetworkStatusSnapshot {
    return this.snapshot;
  }

  getServerSnapshot(): NetworkStatusSnapshot {
    return SERVER_SNAPSHOT;
  }
}

const globalNetworkStore = new NetworkStatusStore();

const subscribe = (listener: Listener) => globalNetworkStore.subscribe(listener);
const getSnapshot = () => globalNetworkStore.getSnapshot();
const getServerSnapshot = () => globalNetworkStore.getServerSnapshot();

/**
 * Tracks real network connectivity, not just `navigator.onLine`.
 *
 * `navigator.onLine` can report `true` while the device has no actual
 * internet access. This hook periodically pings a tiny endpoint and listens
 * to browser online/offline events.
 */
export function useNetworkStatus() {
  const { state, lastOnline } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    state,
    isOnline: state === "online",
    isOffline: state === "offline",
    lastOnline,
  };
}
