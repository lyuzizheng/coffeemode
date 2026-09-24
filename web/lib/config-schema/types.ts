/** Everything else (DG107): product parameters from `config/app.yaml`. */
export interface AppConfig {
  search: {
    maxRadiusKm: number;
    defaultSuggestionLimit: number;
    maxSuggestionLimit: number;
    weakResultsThreshold: number;
    dbFetchCap: number;
    edgeCache: {
      ttlSeconds: number;
      maxEntries: number;
    };
    minPoiQueryLength: number;
    relevanceWeights: {
      exactNameMatch: number;
      prefixMatch: number;
      fuzzyMatch: number;
      secondaryMatch: number;
    };
    minRelevanceScore: number;
    externalSources: {
      google: boolean;
      apple: boolean;
    };
    rankingMode: string;
    goodFirst: {
      experienceMin: number;
      compositeMin: number;
      boost: number;
    };
    responseCache: {
      maxAgeSeconds: number;
      staleWhileRevalidateSeconds: number;
    };
    client: {
      minQueryLength: number;
      debounceMs: number;
    };
  };
  stats: {
    dimWeights: {
      wifi: number;
      outlets: number;
      seats: number;
      temp: number;
      coffee: number;
    };
    recencyDecay: number;
  };
  cafes: {
    listLimitMax: number;
    placeProximityMaxKm: number;
  };
  feed: {
    pageSize: number;
    helpful: {
      halfLifeDays: number;
      snapshotRetentionDays: number;
    };
  };
  discovery: {
    defaultCenter: {
      lat: number;
      lng: number;
    };
  };
  onboarding: {
    cityCoverageKm: number;
    geolocationTimeoutMs: number;
  };
  seo: {
    shellCache: {
      sMaxAgeSeconds: number;
      staleWhileRevalidateSeconds: number;
      cacheableStatuses: number[];
      bypassOnSetCookieResponse: boolean;
      bypassOnRequestCookiePrefixes: string[];
      varyHeaders: string[];
      sharedCacheAcrossLocales: boolean;
    };
    recoveryLimit: number;
  };
  checkins: {
    photoCap: number;
    noteMaxChars: number;
    pendingDraftTtlHours: number;
    revisitWindowHours: number;
  };
  promptQueue: {
    minAgeHours: number;
    expiryDays: number;
    reaskDelayHours: number;
    maxReasks: number;
    autoCollapseMs: number;
  };
  profile: {
    listLimitMax: number;
    listPageSize: number;
    displayNameMaxChars: number;
    recentSearchesMax: number;
    handle: {
      minChars: number;
      maxChars: number;
      changeCooldownDays: number;
      slugMaxChars: number;
      generateMaxAttempts: number;
    };
  };
  images: {
    maxOriginalDimension: number;
    webpQuality: number;
    /** Timeout for Cloudflare Worker proxy fetches (image-service, POI-service). */
    workerTimeoutMs: number;
    r2DownloadTimeoutMs: number;
    r2UploadTimeoutMs: number;
    downloadSlackBytes: number;
  };
  map: {
    /** Active basemap provider — selects which `map.<provider>` block is live. */
    provider: string;
    /** City-level zoom when the resolved center changes (provider-agnostic). */
    defaultZoom: number;
    /** Street-level zoom when a cafe is selected (provider-agnostic). */
    focusZoom: number;
    /** MapLibre GL provider block — required when `provider` is "maplibre". */
    maplibre: {
      tileStyle: {
        /** Full style document URLs — basemap provider seam. */
        light: string;
        dark: string;
      };
    };
  };
  query: {
    staleTimeMs: number;
    gcTimeMs: number;
    persistMaxAgeMs: number;
  };
  staging: {
    /** Staging-journey Vitest worker cap (spec 0010 S4). */
    maxWorkers: number;
  };
  runtimeConfig: {
    responseCache: {
      sMaxAgeSeconds: number;
      staleWhileRevalidateSeconds: number;
    };
  };
  validation: {
    cafeAddressMaxChars: number;
    profileCityMaxChars: number;
    profileCityNameMaxChars: number;
  };
  budgets: {
    bundle: {
      maxJsChunkBytes: number;
      maxCssChunkBytes: number;
      maxTotalStaticBytes: number;
      /** Per-chunk budget exemptions: a chunk containing `marker` may grow
       * to `maxBytes` (map-home: maplibre-gl's ~1 MB chunk). */
      chunkExemptions: { marker: string; maxBytes: number }[];
    };
    lighthouse: {
      performance: number;
      /** `/` floor — the map surface can't hold the static-scaffold 0.8. */
      performanceHome: number;
      /** `/cafes/[id]` floor — DG124 hydrates the same map app under the
       * SSR shell, so the cafe page carries the map bundle too. */
      performanceCafe: number;
      accessibility: number;
      bestPractices: number;
      seo: number;
    };
  };
}
