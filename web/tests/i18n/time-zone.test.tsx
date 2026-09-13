import { afterAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useFormatter } from "next-intl";
import { Providers } from "@/app/providers";
import requestConfig from "@/i18n/request";
import { TIME_ZONE } from "@/i18n/config";
import messages from "../../messages/en.json";

/**
 * BRAWUKA-214: the server request config and the client provider must serve the
 * same time zone. They are two consumers of one constant (`i18n/config.ts`), so
 * a regression is one of them losing it — either side alone leaves the intl
 * context time-zone-less, which logs `IntlError(ENVIRONMENT_FALLBACK)` on every
 * server render and splits date output between SSR and hydration.
 *
 * Only next-intl's module-level wrapper and the Next request context are
 * mocked; the request config, the constant, and the provider chain are the real
 * ones.
 */
vi.mock("next-intl/server", () => ({
  // Outside the RSC condition `next-intl/server` resolves to a throwing stub
  // (its react-client entry). `i18n/request.ts` calls this at module scope, so
  // the mock has to hand the callback straight back.
  getRequestConfig: (config: unknown) => config,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));

const INSTANT = new Date("2026-01-02T03:04:05.000Z");

function stamp(timeZone?: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "numeric",
    timeZoneName: "long",
    timeZone,
  }).format(INSTANT);
}

/** Renders what next-intl's client context says the current time zone is. */
function Stamp() {
  const format = useFormatter();
  return (
    <output data-testid="stamp">
      {format.dateTime(INSTANT, { hour: "numeric", minute: "numeric", timeZoneName: "long" })}
    </output>
  );
}

const originalTimeZone = process.env.TZ;

afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe("i18n time zone parity (BRAWUKA-214)", () => {
  it("serves the shared TIME_ZONE from the server request config", async () => {
    const config = await requestConfig({ requestLocale: Promise.resolve("en") });

    expect(config.timeZone).toBe(TIME_ZONE);
  });

  it("hands the same TIME_ZONE to the client provider chain", () => {
    // `next-themes` (inside `Providers`) reads the system preference.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    // A non-UTC environment default, so a provider that lost its timeZone
    // renders the environment's zone instead of the shared one — otherwise the
    // assertion below would hold vacuously on a UTC machine.
    process.env.TZ = "Asia/Shanghai";
    const expected = stamp(TIME_ZONE);
    expect(expected).not.toBe(stamp(undefined));

    render(
      <Providers locale="en" messages={messages}>
        <Stamp />
      </Providers>,
    );

    expect(screen.getByTestId("stamp")).toHaveTextContent(expected);
  });
});
