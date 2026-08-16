import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

// Locale resolution, in order: explicit cookie choice (a future switcher sets
// it) → Accept-Language negotiation → en default. Without this, requestLocale
// is always undefined and zh copy was unreachable in production.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  let locale: string;
  if (requested === "zh" || requested === "en") {
    locale = requested;
  } else {
    const cookieLocale = (await cookies()).get("locale")?.value;
    if (cookieLocale === "zh" || cookieLocale === "en") {
      locale = cookieLocale;
    } else {
      const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
      locale = accept.includes("zh") ? "zh" : "en";
    }
  }

  return {
    locale,
    // next-intl v4 requires a timeZone for SSR/client markup parity
    // (ENVIRONMENT_FALLBACK error without one). CoffeeMode has no
    // date-formatting surface yet; UTC keeps SSR and hydration identical.
    timeZone: "UTC",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
