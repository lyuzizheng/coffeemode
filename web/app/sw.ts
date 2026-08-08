/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const IMAGE_HOST = "images.coffeemode.app";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // The home page is dynamic (reads cookies); never cache it. The offline
    // fallback page handles navigation when the network is unavailable.
    {
      matcher: ({ url: { pathname } }) => pathname === "/",
      method: "GET",
      handler: new NetworkOnly(),
    },
    // Service worker and manifest must always be fresh.
    {
      matcher: ({ url: { pathname } }) =>
        pathname === "/serwist/sw.js" || pathname === "/manifest.webmanifest",
      method: "GET",
      handler: new NetworkOnly(),
    },
    // Auth and uploads must always be fresh.
    {
      matcher: ({ url: { pathname } }) => pathname.startsWith("/auth/"),
      method: "GET",
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url: { pathname } }) => pathname.startsWith("/api/images/"),
      method: "GET",
      handler: new NetworkOnly(),
    },
    // The health ping and POI proxy should not be double-cached.
    {
      matcher: ({ url: { pathname } }) =>
        pathname.startsWith("/api/health") || pathname.startsWith("/api/places/"),
      method: "GET",
      handler: new NetworkOnly(),
    },
    // Cafe/check-in data is allowed to be stale for a short time.
    {
      matcher: ({ url: { pathname } }) =>
        pathname.startsWith("/api/cafes/") || pathname.startsWith("/api/checkins/"),
      method: "GET",
      handler: new NetworkFirst({
        cacheName: "api-cafe-data",
        plugins: [new ExpirationPlugin({ maxAgeSeconds: 5 * 60 })],
      }),
    },
    // R2 image variants are immutable once processed.
    {
      matcher: ({ url }) => url.hostname === IMAGE_HOST,
      method: "GET",
      handler: new NetworkFirst({
        cacheName: "r2-images",
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
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
