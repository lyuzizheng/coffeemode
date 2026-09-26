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
 * 400-line hard budget, and both the spawn block and the teardown touch
 * the same two processes.
 */
import { spawnStandaloneServer, getFreePort, waitForServer } from "./standalone-server.mjs";

const DEAD_DATABASE_URL = "postgres://coffeemode:coffeemode@127.0.0.1:1/coffeemode";

export function createProbeServers({ root, dbUrl, supabaseUrl, supabaseAnonKey }) {
  let serverProcess = null;
  let deadServerProcess = null;
  let serverOutput = "";
  let deadServerOutput = "";

  function startMain(port) {
    serverProcess = spawnStandaloneServer({
      cwd: root,
      port,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        DATABASE_URL: dbUrl,
        // T8 signs in for real: the standalone server must reach the
        // supabase-mock (compose service, :54321) for session validation.
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
      },
    });
    serverProcess.stdout.on("data", (d) => {
      serverOutput += d.toString();
      process.stdout.write(`[Next.js Server] ${d.toString()}`);
    });
    serverProcess.stderr.on("data", (d) => {
      serverOutput += d.toString();
    });
    return serverProcess;
  }

  async function startDeadProbe() {
    const deadPort = await getFreePort();
    const deadBase = `http://127.0.0.1:${deadPort}`;
    deadServerProcess = spawnStandaloneServer({
      cwd: root,
      port: deadPort,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        DATABASE_URL: DEAD_DATABASE_URL,
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      },
    });
    deadServerProcess.stdout.on("data", (d) => {
      deadServerOutput += d.toString();
    });
    deadServerProcess.stderr.on("data", (d) => {
      deadServerOutput += d.toString();
    });
    await waitForServer(deadBase);
    console.log(`[E2E] Dead-DB probe ready at ${deadBase}`);
    return deadBase;
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

  return { startMain, startDeadProbe, captureServerOutput, stopAll, mainProcess };
}
