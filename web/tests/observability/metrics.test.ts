import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metricEndpoint, recordCafeCreated, recordLogin } from "@/lib/observability/metrics";

/**
 * The recording logic, driven through the module's own meter seam.
 *
 * `metrics.ts` caches its `MeterProvider` on `globalThis` so every bundle in
 * the process shares one export timer (BRAWUKA-609). Seeding that slot with a
 * recording meter exercises exactly what the module decides — instrument name,
 * description, attributes — without a provider, a timer, or an HTTP round trip.
 * The wiring that builds a real provider is covered by the last block.
 */
type Add = { value: number; attributes?: Record<string, unknown> };
type Instrument = { name: string; description: string; adds: Add[] };

const PROVIDER_KEY = "__coffeemodeOtlpMetrics";

/** Seed the meter slot with a recorder and return what it receives. */
function capture(): Instrument[] {
  const instruments: Instrument[] = [];
  (globalThis as Record<string, unknown>)[PROVIDER_KEY] = {
    createCounter: (name: string, options: { description?: string }) => {
      const instrument: Instrument = { name, description: options.description ?? "", adds: [] };
      instruments.push(instrument);
      return {
        add: (value: number, attributes?: Record<string, unknown>) =>
          instrument.adds.push({ value, attributes }),
      };
    },
  };
  return instruments;
}

function clearMeter(): void {
  delete (globalThis as Record<string, unknown>)[PROVIDER_KEY];
}

beforeEach(() => {
  clearMeter();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example/otlp";
});

afterEach(() => {
  clearMeter();
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
});

describe("business counters", () => {
  it("counts a cafe creation under the source it started from", () => {
    const instruments = capture();

    recordCafeCreated("google");

    // The name is the Prometheus series prefix and the source is its only
    // label, so both are contract, not implementation.
    expect(instruments).toHaveLength(1);
    expect(instruments[0].name).toBe("coffeemode.cafe.created");
    expect(instruments[0].adds).toEqual([{ value: 1, attributes: { source: "google" } }]);
  });

  it("counts a completed sign-in with no dimensions", () => {
    const instruments = capture();

    recordLogin();

    expect(instruments).toHaveLength(1);
    expect(instruments[0].name).toBe("coffeemode.auth.login");
    expect(instruments[0].adds).toEqual([{ value: 1 }]);
  });

  it("accumulates on one instrument instead of rebuilding it per event", () => {
    const instruments = capture();

    recordCafeCreated("google");
    recordCafeCreated("manual");
    recordCafeCreated("manual");

    expect(instruments).toHaveLength(1);
    expect(instruments[0].adds.map((add) => add.attributes?.source)).toEqual([
      "google",
      "manual",
      "manual",
    ]);
  });
});

describe("never-throws contract", () => {
  it("swallows a throwing meter instead of failing the request that recorded", () => {
    (globalThis as Record<string, unknown>)[PROVIDER_KEY] = {
      createCounter: () => {
        throw new Error("collector down");
      },
    };

    expect(() => recordCafeCreated("google")).not.toThrow();
    expect(() => recordLogin()).not.toThrow();
  });
});

describe("provider wiring", () => {
  it("builds and caches a meter once the endpoint is configured", () => {
    clearMeter();

    recordCafeCreated("google");

    const cached = (globalThis as Record<string, unknown>)[PROVIDER_KEY] as {
      createCounter?: unknown;
    };
    expect(typeof cached?.createCounter).toBe("function");
  });

  it("stays silent and builds nothing when no endpoint is configured", () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    clearMeter();

    recordCafeCreated("google");

    expect((globalThis as Record<string, unknown>)[PROVIDER_KEY]).toBeUndefined();
  });

  it("prefers the metrics-specific endpoint over the signal-agnostic one", () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://metrics.example/v1/metrics";

    expect(metricEndpoint()).toBe("https://metrics.example/v1/metrics");
  });
});
