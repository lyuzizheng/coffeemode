import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested === "zh" ? "zh" : "en";

  return {
    locale,
    // next-intl v4 requires a timeZone for SSR/client markup parity
    // (ENVIRONMENT_FALLBACK error without one). CoffeeMode has no
    // date-formatting surface yet; UTC keeps SSR and hydration identical.
    timeZone: "UTC",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
