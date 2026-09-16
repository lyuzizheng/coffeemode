import type { useTranslations } from "next-intl";
import type { POI } from "@shared/places/types";

/** The `create` namespace translator — providers render their own labels. */
export type CreateTranslator = ReturnType<typeof useTranslations<"create">>;

/**
 * Place-search/geocoding provider contract (owner directive 2026-09-16: the
 * map and geocoding services are replaceable layers — a Google/Apple swap is
 * a new entry in `getPlaceSearchProviders`, never a rewrite of the creation
 * UI). Client-safe: providers encapsulate their own transport (server API
 * route vs. vendor JS SDK).
 */
export interface PlaceSearchProvider {
  /** Stable id — also the i18n key under `create.*` for the provider label. */
  id: string;
  /** Localized display label (result badge + toggle). */
  label: string;
  /** One-time async setup (script load, token fetch). Awaited on selection;
   * a rejection surfaces as the provider's unavailable error. */
  init?(): Promise<void>;
  /** Text search → POIs. `bias` is the user's known center when available. */
  search(query: string, bias?: { lat: number; lng: number }): Promise<POI[]>;
  /** Client-side results that must be persisted on select (e.g. MapKit). */
  persistOnSelect?: boolean;
}
