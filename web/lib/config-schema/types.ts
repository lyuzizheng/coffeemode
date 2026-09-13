/** Everything else (DG107): product parameters from `config/app.yaml`. */
export interface AppConfig {
  search: {
    maxRadiusKm: number;
    defaultSuggestionLimit: number;
    maxSuggestionLimit: number;
    weakResultsThreshold: number;
    dbFetchCap: number;
    maxIterativeFetchBatches: number;
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
  };
  feed: {
    pageSize: number;
  };
  discovery: {
    defaultCenter: {
      lat: number;
      lng: number;
    };
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
    r2DownloadTimeoutMs: number;
    r2UploadTimeoutMs: number;
    downloadSlackBytes: number;
  };
  query: {
    staleTimeMs: number;
    gcTimeMs: number;
    persistMaxAgeMs: number;
  };
  validation: {
    cafeAddressMaxChars: number;
    profileCityMaxChars: number;
  };
  budgets: {
    bundle: {
      maxJsChunkBytes: number;
      maxCssChunkBytes: number;
      maxTotalStaticBytes: number;
    };
    lighthouse: {
      performance: number;
      accessibility: number;
      bestPractices: number;
      seo: number;
    };
  };
}
