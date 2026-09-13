import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { TIME_ZONE } from "./config";

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
    // Shared with the client provider in `app/providers.tsx`; see
    // `i18n/config.ts` for why the two must never drift apart.
    timeZone: TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
