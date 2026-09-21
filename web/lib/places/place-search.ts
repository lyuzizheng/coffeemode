import type { useTranslations } from "next-intl";
import type { POI, PlacePrediction } from "@shared/places/types";

/** The `create` namespace translator — providers render their own labels. */
export type CreateTranslator = ReturnType<typeof useTranslations<"create">>;

/**
 * One typing-phase hit. `poi` is set when the provider already holds the full
 * record (Apple MapKit returns everything in one call); Google predictions
 * carry only an id and are resolved on selection.
 */
export interface PlaceCandidate {
  prediction: PlacePrediction;
  poi?: POI;
}

/**
 * Place-search/geocoding provider contract (owner directive 2026-09-16: the
 * map and geocoding services are replaceable layers — a Google/Apple swap is
 * a new entry in `getPlaceSearchProviders`, never a rewrite of the creation
 * UI). Client-safe: providers encapsulate their own transport (server API
 * route vs. vendor JS SDK).
 *
 * Two phases (BRAWUKA-602), because Google bills them differently:
 * `search` is the typing phase (Autocomplete — free while the session is
 * open) and `resolve` is the selection phase (Place Details — the only
 * billed call). A provider whose SDK returns full records up front answers
 * `resolve` from the candidate it already built.
 */
export interface PlaceSearchProvider {
  /** Stable id — also the i18n key under `create.*` for the provider label. */
  id: string;
  /** Localized display label (result badge + toggle). */
  label: string;
  /** One-time async setup (script load, token fetch). Awaited on selection;
   * a rejection surfaces as the provider's unavailable error. */
  init?(): Promise<void>;
  /** Typing phase → candidates. `bias` is the user's known center when available. */
  search(query: string, bias?: { lat: number; lng: number }): Promise<PlaceCandidate[]>;
  /** Selection phase → the full POI. Google terminates its Autocomplete
   *  session here; that is what makes the typing phase free. */
  resolve(candidate: PlaceCandidate): Promise<POI>;
  /** Client-side results that must be persisted on select (e.g. MapKit). */
  persistOnSelect?: boolean;
}
