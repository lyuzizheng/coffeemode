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

class NetworkStatusStore {
  private state: NetworkState = typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline";
  private lastOnline: Date | null = null;
  private listeners = new Set<Listener>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setState(next: NetworkState) {
    if (this.state === next) return;
    this.state = next;
    if (next === "online") {
      this.lastOnline = new Date();
    }
    this.emit();
  }

  private async ping() {
    if (typeof navigator === "undefined") return;

    if (!navigator.onLine) {
      this.setState("offline");
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(PING_URL, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.setState(response.ok ? "online" : "offline");
    } catch {
      this.setState("offline");
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    if (!this.mounted) {
      this.mounted = true;
      const handleOnline = () => {
        this.setState("online");
      };
      const handleOffline = () => {
        this.setState("offline");
      };
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      // Defer the first ping so it does not run during render.
      setTimeout(() => void this.ping(), 0);
      this.interval = setInterval(() => void this.ping(), PING_INTERVAL_MS);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        if (this.interval) clearInterval(this.interval);
        this.mounted = false;
      };
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): NetworkStatusSnapshot {
    return { state: this.state, lastOnline: this.lastOnline };
  }
}

const globalNetworkStore = new NetworkStatusStore();

/**
 * Tracks real network connectivity, not just `navigator.onLine`.
 *
 * `navigator.onLine` can report `true` while the device has no actual
 * internet access. This hook periodically pings a tiny endpoint and listens
 * to browser online/offline events.
 */
export function useNetworkStatus() {
  const { state, lastOnline } = useSyncExternalStore(
    (listener) => globalNetworkStore.subscribe(listener),
    () => globalNetworkStore.getSnapshot(),
    () => ({ state: "online" as NetworkState, lastOnline: null }),
  );

  return {
    state,
    isOnline: state === "online",
    isOffline: state === "offline",
    lastOnline,
  };
}
