/**
 * The application's time zone.
 *
 * One source for two consumers that MUST agree: the server request config
 * (`i18n/request.ts`) and the client provider (`app/providers.tsx`). Client
 * components using next-intl also render on the server, so if the two ever
 * drift apart — or either side loses the value — the date/number output of the
 * same component diverges between the server markup and hydration; a provider
 * without one additionally logs `IntlError(ENVIRONMENT_FALLBACK)` on every
 * request (BRAWUKA-214).
 *
 * Keep this module dependency-free: `app/providers.tsx` is a client component,
 * so it must not import `i18n/request.ts` (which reads `next/headers`).
 *
 * CoffeeMode has no date-formatting surface yet; UTC keeps SSR and hydration
 * identical.
 */
export const TIME_ZONE = "UTC";
