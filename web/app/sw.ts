/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";
import { RUNTIME_RULES, type CacheStrategy, type SwRule } from "@/lib/sw-rules";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Map a plain rule descriptor to a serwist handler instance. */
function toHandler(rule: SwRule): NetworkOnly | NetworkFirst | CacheFirst {
  const cache = rule.cache;
  const plugins =
    cache && cache.maxEntries !== undefined
      ? [
          new ExpirationPlugin({
            maxEntries: cache.maxEntries,
            ...(cache.maxAgeSeconds !== undefined
              ? { maxAgeSeconds: cache.maxAgeSeconds }
              : {}),
          }),
        ]
      : undefined;
  const options = cache ? { cacheName: cache.cacheName, ...(plugins ? { plugins } : {}) } : undefined;

  switch (rule.handler as CacheStrategy) {
    case "network-only":
      return new NetworkOnly();
    case "network-first":
      return new NetworkFirst(options);
    case "cache-first":
      return new CacheFirst(options);
  }
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    ...RUNTIME_RULES.map((rule) => ({
      matcher: rule.matcher,
      method: rule.method,
      handler: toHandler(rule),
    })),
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
