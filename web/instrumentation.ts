import { registerOtel } from "@/lib/observability/otel";

export async function register(): Promise<void> {
  // Traces first: the SDK has to be registered before any instrumented code
  // runs, and it is a no-op unless the deployment configured an OTLP endpoint
  // (BRAWUKA-606, docs/devops/grafana-cloud-adoption.md §3 P0-2).
  registerOtel();

  if (typeof process === "undefined" || process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Dynamic on purpose: this file is bundled for every runtime, and
  // `lib/db/postgres` pulls in `pg`, which only exists under Node.
  const { registerPoolShutdownHandlers } = await import("@/lib/db/postgres");
  registerPoolShutdownHandlers();
}
