import { positiveInteger, record, statusList, stringList } from "./primitives";
import type { AppConfig } from "./types";

type SeoConfig = AppConfig["seo"];

function parseShellCache(
  file: string,
  value: unknown,
): SeoConfig["shellCache"] {
  const shellCache = record(file, "seo.shellCache", value);
  return {
    sMaxAgeSeconds: positiveInteger(
      file,
      "seo.shellCache.sMaxAgeSeconds",
      shellCache.sMaxAgeSeconds,
    ),
    staleWhileRevalidateSeconds: positiveInteger(
      file,
      "seo.shellCache.staleWhileRevalidateSeconds",
      shellCache.staleWhileRevalidateSeconds,
    ),
    cacheableStatuses: statusList(
      file,
      "seo.shellCache.cacheableStatuses",
      shellCache.cacheableStatuses,
    ),
    revalidatableStatuses: statusList(
      file,
      "seo.shellCache.revalidatableStatuses",
      shellCache.revalidatableStatuses,
    ),
    bypassOnRequestCookiePrefixes: stringList(
      file,
      "seo.shellCache.bypassOnRequestCookiePrefixes",
      shellCache.bypassOnRequestCookiePrefixes,
    ),
    bypassOnRequestCookies: stringList(
      file,
      "seo.shellCache.bypassOnRequestCookies",
      shellCache.bypassOnRequestCookies,
    ),
    bypassOnAcceptLanguageWildcards: stringList(
      file,
      "seo.shellCache.bypassOnAcceptLanguageWildcards",
      shellCache.bypassOnAcceptLanguageWildcards,
    ),
    bypassOnHosts: stringList(
      file,
      "seo.shellCache.bypassOnHosts",
      shellCache.bypassOnHosts,
    ),
  };
}

/** Validate the `seo` subtree of app.yaml. */
export function parseSeoSection(file: string, seo: Record<string, unknown>): SeoConfig {
  return {
    shellCache: parseShellCache(file, seo.shellCache),
    recoveryLimit: positiveInteger(file, "seo.recoveryLimit", seo.recoveryLimit),
  };
}
