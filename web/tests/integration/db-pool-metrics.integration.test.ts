/**
 * @vitest-environment node
 * Application DB pool metric contract (BRAWUKA-976, under BRAWUKA-969).
 *
 * The launch dashboard needs to separate "the app's pool is exhausted" from
 * every other cause of request latency, without a database exporter, a new
 * credential, or a pool refactor. This suite pins the contract the Grafana
 * panel reads:
 *
 * 1. The gauge is `coffeemode.db.pool.connections`, one point per bounded
 *    `state` (`active`, `idle`, `waiting`).
 * 2. `active` + `idle` are open pool connections; `waiting` is queued
 *    requests, never an additional connection.
 * 3. No pool emits no points; an open pool with no connections emits three
 *    measured zeros. The dashboard must not read "no data" as "zero".
 * 4. Sampling reads the existing pool lazily: it never initializes the pool
 *    and never opens a connection.
 * 5. Real node-postgres counters move through idle → occupied → queued →
 *    idle under a pool capped at one connection.
 */
import {
  DataPointType,
  MeterProvider,
  MetricReader,
  type CollectionResult,
  type GaugeMetricData,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool, samplePoolConnections } from "@/lib/db/postgres";
import {
  createPoolConnectionsGauge,
  type PoolConnectionCounts,
} from "@/lib/observability/metrics";
import {
  setupTestDatabase,
  teardownTestDatabase,
  type TestDatabaseContext,
} from "../helpers/db";

const METRIC = "coffeemode.db.pool.connections";

/** Minimal reader: `collect()` is the assertion surface, nothing is exported. */
class CapturingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function gaugeMetric(result: CollectionResult): MetricData | undefined {
  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name === METRIC) return metric;
    }
  }
  return undefined;
}

function gaugePoints(result: CollectionResult): GaugeMetricData["dataPoints"] {
  const metric = gaugeMetric(result);
  if (metric === undefined) return [];
  if (metric.dataPointType !== DataPointType.GAUGE) {
    throw new Error(`expected a gauge, got ${metric.dataPointType}`);
  }
  return (metric as GaugeMetricData).dataPoints;
}

/** `state → value`, the shape the panel groups by. */
function states(result: CollectionResult): Record<string, number> {
  return Object.fromEntries(
    gaugePoints(result).map((point) => [String(point.attributes.state), point.value]),
  );
}

describe("db pool gauge contract (BRAWUKA-976)", () => {
  it("emits no data before a pool exists, and three measured zeros after", async () => {
    const reader = new CapturingReader();
    const provider = new MeterProvider({ readers: [reader] });
    let counts: PoolConnectionCounts | null = null;
    createPoolConnectionsGauge(provider.getMeter("pool-metric-contract"), () => counts);

    try {
      // No pool: an empty observation set, not a zero series.
      expect(gaugePoints(await reader.collect())).toHaveLength(0);

      counts = { active: 2, idle: 3, waiting: 1 };
      expect(states(await reader.collect())).toEqual({ active: 2, idle: 3, waiting: 1 });

      // A measured zero is still a measurement.
      counts = { active: 0, idle: 0, waiting: 0 };
      expect(states(await reader.collect())).toEqual({ active: 0, idle: 0, waiting: 0 });
    } finally {
      await provider.shutdown();
    }
  });
});

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIntegration("integration — db pool metric against real Postgres (BRAWUKA-976)", () => {
  let context: TestDatabaseContext;
  let savedMetricsEndpoint: string | undefined;
  let savedGenericEndpoint: string | undefined;
  let savedPoolMax: string | undefined;

  beforeAll(async () => {
    // A real OTLP provider here would attempt exports; the contract is read
    // through the capturing reader above, and `getPool()` must stay silent.
    savedMetricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    savedGenericEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    savedPoolMax = process.env.DATABASE_POOL_MAX;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    // One connection makes the queued state reachable deterministically.
    process.env.DATABASE_POOL_MAX = "1";

    context = await setupTestDatabase("coffeemode_pool_metrics");
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(context);
    if (savedMetricsEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = savedMetricsEndpoint;
    if (savedGenericEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedGenericEndpoint;
    if (savedPoolMax === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = savedPoolMax;
  }, 120_000);

  it("reports no data instead of zero before the pool exists", () => {
    // `setupTestDatabase` closed the pool; sampling must not reopen it.
    expect(samplePoolConnections()).toBeNull();
    expect(samplePoolConnections()).toBeNull();
  });

  it("tracks idle, occupied, and queued states on the real pool", async () => {
    const pool = getPool();
    expect(samplePoolConnections()).toEqual({ active: 0, idle: 0, waiting: 0 });

    const holder = await pool.connect();
    let holderReleased = false;
    const releaseHolder = () => {
      if (holderReleased) return;
      holderReleased = true;
      holder.release();
    };

    try {
      await holder.query("select 1");
      expect(samplePoolConnections()).toEqual({ active: 1, idle: 0, waiting: 0 });

      // Capped at one connection, this one queues synchronously.
      const queued = pool.connect();
      try {
        expect(samplePoolConnections()).toEqual({ active: 1, idle: 0, waiting: 1 });

        releaseHolder();
        const waiter = await queued;
        try {
          await waiter.query("select 1");
          // The queued request now owns the one connection; nothing is idling.
          expect(samplePoolConnections()).toEqual({ active: 1, idle: 0, waiting: 0 });
        } finally {
          waiter.release();
        }
      } finally {
        // A failed assertion before the handoff must not leak a pending connect.
        queued.catch(() => {});
      }
    } finally {
      releaseHolder();
    }

    expect(samplePoolConnections()).toEqual({ active: 0, idle: 1, waiting: 0 });

    await closePool();
  });
});
