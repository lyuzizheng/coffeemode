/**
 * Dual-server harness for the E2E suite (BRAWUKA-729/BRAWUKA-755, T28).
 *
 * The suite's main standalone server proves every case against the live
 * pool; the deterministic 5xx needs the same build on an unreachable
 * database port so one anonymous read fails the real pool round-trip and
 * the access line carries the produced 500. Both servers share the access
 * stream: the gate reads the union of their outputs via
 * `captureServerOutput()`.
 *
 * One module, not inline code: `scripts/e2e-smoke.mjs` is frozen at the
 * 400-line hard budget and capped at complexity 15, and both the spawn
 * block and the teardown touch the same two processes.
 */
import {
  spawnStandaloneServer,
  getFreePort,
  waitForServer,
  reportServerRenderErrors,
} from "./standalone-server.mjs";
import { ACCESS_LOG_LATENCY_FLOOR_MS } from "./access-log-gate.mjs";

const DEAD_DATABASE_URL = "postgres://coffeemode:coffeemode@127.0.0.1:1/coffeemode";

// Resolve the floor without the gate's fail-loud throw: the harness is the
// injector, so an unset variable means the default — never a silent zero.
function probeAccessLogDelayMs() {
  const raw = process.env.E2E_ACCESS_LOG_DELAY_MS;
  if (raw === undefined) return ACCESS_LOG_LATENCY_FLOOR_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return ACCESS_LOG_LATENCY_FLOOR_MS;
  return Math.min(parsed, 500);
}

function attachOutputCapture(child, onData) {
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
}

function spawnMainServer({ root, port, dbUrl, supabaseUrl, supabaseAnonKey, onData }) {
  const child = spawnStandaloneServer({
    cwd: root,
    port,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      DATABASE_URL: dbUrl,
      // T8 signs in for real: the standalone server must reach the
      // supabase-mock (compose service, :54321) for session validation.
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
      // BRAWUKA-755: controlled handler latency for the T28 duration
      // lower-bound proof — inside the real dependency path, capped
      // server-side at 500ms. The managed harness always forwards the
      // floor (default ACCESS_LOG_LATENCY_FLOOR_MS); explicit
      // E2E_ACCESS_LOG_DELAY_MS=0 opts out to a fast smoke path.
      E2E_ACCESS_LOG_DELAY_MS: String(probeAccessLogDelayMs()),
    },
  });
  attachOutputCapture(child, (d) => {
    onData(d.toString());
    process.stdout.write(`[Next.js Server] ${d.toString()}`);
  });
  return child;
}

function spawnDeadServer({ root, port }) {
  const child = spawnStandaloneServer({
    cwd: root,
    port,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      DATABASE_URL: DEAD_DATABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  });
  return child;
}

export function createProbeServers({ root, dbUrl, supabaseUrl, supabaseAnonKey }) {
  let serverProcess = null;
  let deadServerProcess = null;
  let serverOutput = "";
  let deadServerOutput = "";

  function startMain(port) {
    serverProcess = spawnMainServer({
      root,
      port,
      dbUrl,
      supabaseUrl,
      supabaseAnonKey,
      onData: (text) => {
        serverOutput += text;
      },
    });
    return serverProcess;
  }

  async function startDeadProbe() {
    const deadPort = await getFreePort();
    const deadBase = `http://127.0.0.1:${deadPort}`;
    deadServerProcess = spawnDeadServer({ root, port: deadPort });
    attachOutputCapture(deadServerProcess, (d) => {
      deadServerOutput += d.toString();
    });
    await waitForServer(deadBase);
    console.log(`[E2E] Dead-DB probe ready at ${deadBase}`);
    return deadBase;
  }

  // Boot the main build plus (when eligible) the dead-DB 5xx probe, then
  // wait for the main base. Owns the port/branch/wait logic so
  // `runSmokeSuite` stays under the complexity budget.
  async function bootAll({ port, useExternalBase, hasDb, failures }) {
    const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
    // BRAWUKA-755: resolve the latency floor once and supply the same value
    // to both sides — the child server (spawn env below) and the parent
    // gate (which reads process.env at assertion time). Without this the
    // gate throws on an unset variable while the server slept the default.
    process.env.E2E_ACCESS_LOG_DELAY_MS = String(probeAccessLogDelayMs());
    if (!useExternalBase) {
      startMain(port);
      reportServerRenderErrors(serverProcess, {
        failures,
        onLine: (text) => process.stderr.write(`[Next.js Server ERROR] ${text}`),
      });
    }
    let deadBase = null;
    if (!useExternalBase && hasDb) {
      deadBase = await startDeadProbe();
    }
    await waitForServer(base);
    console.log(`[E2E] Web server ready at ${base}`);
    return { base, deadBase, useExternalBase };
  }

  function captureServerOutput() {
    return `${serverOutput}${deadServerOutput}`;
  }

  function stopAll() {
    for (const child of [serverProcess, deadServerProcess]) {
      try {
        child?.kill("SIGTERM");
      } catch {
        // Benign: server process may have already exited.
      }
    }
    serverProcess = null;
    deadServerProcess = null;
  }

  function mainProcess() {
    return serverProcess;
  }

  return { startMain, startDeadProbe, bootAll, captureServerOutput, stopAll, mainProcess };
}
