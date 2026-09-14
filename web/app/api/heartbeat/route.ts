import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { apiError } from "@/lib/api/response";
import { pingDatabase } from "@/lib/db/heartbeat";
import { logError } from "@/lib/observability/server-log";
import { resolveAppVersion } from "@/lib/version";

/** Deployment environment label: safe, non-secret, operator-set. */
function resolveEnv(): string {
  const explicit = process.env.APP_ENV?.trim();
  if (explicit) return explicit;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * GET /api/heartbeat
 *
 * Keepalive + uptime probe (BRAWUKA-284). Runs one real `select 1` so the
 * Supabase free-tier staging project sees genuine database activity — a
 * static JSON response would not count as activity and would not keep the
 * project awake. Unauthenticated by design; the body carries no secrets.
 * Better Stack polls this every 5–10 min; 503 on DB failure is the alert
 * signal. The WAF rule (BRAWUKA-237) whitelists the Better Stack UA plus
 * `coffeemode-smoke/1.0` — curl's default UA is challenged at the edge.
 */
export async function GET(request: Request) {
  const gate = await guard(request, {
    bucket: "heartbeat",
    route: "GET /api/heartbeat",
    ipOnly: true,
    user: null,
  });
  if (!gate.ok) return gate.response;
  try {
    await pingDatabase();
  } catch (err) {
    logError({ route: gate.route, request, error: err, status: 503 });
    return apiError("db_unavailable", "database unavailable", 503);
  }
  return NextResponse.json(
    {
      ok: true,
      env: resolveEnv(),
      version: resolveAppVersion(),
      db: "up",
      ts: new Date().toISOString(),
    },
    { status: 200 },
  );
}
