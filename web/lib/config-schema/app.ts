import { coordinate, positiveNumber, record } from "./primitives";
import { parseBudgetsSection } from "./budgets";
import { parseCheckinsSection } from "./checkins";
import { parseProfileSection } from "./profile";
import { parseSearchSection } from "./search";
import { parseSeoSection } from "./seo";
import type { AppConfig } from "./types";

export type { AppConfig } from "./types";

function parseStatsSection(file: string, value: unknown): AppConfig["stats"] {
  const stats = record(file, "stats", value);
  const dimWeights = record(file, "stats.dimWeights", stats.dimWeights);
  return {
    dimWeights: {
      wifi: positiveNumber(file, "stats.dimWeights.wifi", dimWeights.wifi),
      outlets: positiveNumber(file, "stats.dimWeights.outlets", dimWeights.outlets),
      seats: positiveNumber(file, "stats.dimWeights.seats", dimWeights.seats),
      temp: positiveNumber(file, "stats.dimWeights.temp", dimWeights.temp),
      coffee: positiveNumber(file, "stats.dimWeights.coffee", dimWeights.coffee),
    },
    recencyDecay: positiveNumber(file, "stats.recencyDecay", stats.recencyDecay),
  };
}

function parseCafesSection(file: string, value: unknown): AppConfig["cafes"] {
  const cafes = record(file, "cafes", value);
  return {
    listLimitMax: positiveNumber(file, "cafes.listLimitMax", cafes.listLimitMax),
  };
}

function parseFeedSection(file: string, value: unknown): AppConfig["feed"] {
  const feed = record(file, "feed", value);
  return {
    pageSize: positiveNumber(file, "feed.pageSize", feed.pageSize),
  };
}

function parseDiscoverySection(file: string, value: unknown): AppConfig["discovery"] {
  const discovery = record(file, "discovery", value);
  const defaultCenter = record(file, "discovery.defaultCenter", discovery.defaultCenter);
  return {
    defaultCenter: {
      lat: coordinate(file, "discovery.defaultCenter.lat", defaultCenter.lat, 90),
      lng: coordinate(file, "discovery.defaultCenter.lng", defaultCenter.lng, 180),
    },
  };
}

/** Validate raw parsed YAML into the typed app config (exported for tests). */
export function parseAppConfig(raw: unknown, file = "app.yaml"): AppConfig {
  const root = record(file, "(root)", raw);
  return {
    search: parseSearchSection(file, record(file, "search", root.search)),
    stats: parseStatsSection(file, root.stats),
    cafes: parseCafesSection(file, root.cafes),
    feed: parseFeedSection(file, root.feed),
    discovery: parseDiscoverySection(file, root.discovery),
    seo: parseSeoSection(file, record(file, "seo", root.seo)),
    checkins: parseCheckinsSection(file, record(file, "checkins", root.checkins)),
    profile: parseProfileSection(file, record(file, "profile", root.profile)),
    budgets: parseBudgetsSection(file, record(file, "budgets", root.budgets)),
  };
}
