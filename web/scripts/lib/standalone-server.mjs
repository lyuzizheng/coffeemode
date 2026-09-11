import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

/**
 * Allocate an ephemeral local TCP port.
 */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = address && typeof address === "object" ? address.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * Prepare and spawn the Next.js standalone production server.
 * Copies static assets and public files to the standalone directory if present.
 */
export function spawnStandaloneServer({
  cwd,
  port,
  host = "127.0.0.1",
  env = {},
  stdio = "ignore",
}) {
  const standaloneDir = join(cwd, ".next", "standalone");
  const serverPath = join(standaloneDir, "server.js");
  if (!existsSync(serverPath)) {
    throw new Error(`Standalone server not found at ${serverPath}. Run \`npm run build\` first.`);
  }

  // Next standalone requires static assets copied in (matching Dockerfile)
  const staticSrc = join(cwd, ".next", "static");
  const staticDest = join(standaloneDir, ".next", "static");
  if (existsSync(staticSrc)) {
    cpSync(staticSrc, staticDest, { recursive: true, force: true });
  }

  const publicSrc = join(cwd, "public");
  const publicDest = join(standaloneDir, "public");
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, publicDest, { recursive: true, force: true });
  }

  return spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    stdio,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOSTNAME: host,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
}

/**
 * Poll until the HTTP server is responding to requests.
 */
export async function waitForServer(
  urlOrBase,
  { attempts = 60, intervalMs = 500, timeoutMs = 1000 } = {},
) {
  const target = urlOrBase.includes("/api/")
    ? urlOrBase
    : `${urlOrBase.replace(/\/+$/, "")}/api/health`;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status > 0) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Server did not start within ${(attempts * intervalMs) / 1000}s at ${urlOrBase}`);
}

/**
 * Signatures of server-rendered failures that must fail a gate. Next writes
 * these to the server process's stderr; a browser-side collector (page console
 * / `pageerror`, as `visual-smoke` and `e2e-smoke` use) never sees them.
 * BRAWUKA-214 was exactly that blind spot: a client provider rendered without
 * an intl `timeZone` logged ENVIRONMENT_FALLBACK on every SSR request while
 * every page-level assertion stayed green.
 */
const SERVER_RENDER_ERRORS = ["ENVIRONMENT_FALLBACK"];

/**
 * Pipe a standalone server's stderr into `onLine`, returning the live array of
 * collected render errors (mutated as output arrives, so read it at the end).
 */
export function collectServerRenderErrors(child, { onLine } = {}) {
  const errors = [];
  child.stderr.on("data", (data) => {
    const text = data.toString();
    // Node runtime notices, not application faults.
    if (text.includes("ExperimentalWarning")) return;
    if (SERVER_RENDER_ERRORS.some((signature) => text.includes(signature))) {
      errors.push(text);
    }
    onLine?.(text);
  });
  return errors;
}

/**
 * Register process signal handlers (SIGINT, SIGTERM, exit) for graceful cleanup.
 */
export function registerProcessCleanup(cleanupFn) {
  let isCleaning = false;

  const runCleanup = async () => {
    if (isCleaning) return;
    isCleaning = true;
    try {
      await cleanupFn();
    } catch (err) {
      console.warn("[standalone-server] Error during async cleanup:", err?.message ?? err);
    }
  };

  process.on("exit", () => {
    try {
      cleanupFn(true);
    } catch {
      // Benign: synchronous process exit handler cannot await; best-effort teardown.
    }
  });
  process.on("SIGINT", async () => {
    await runCleanup();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await runCleanup();
    process.exit(143);
  });

  return runCleanup;
}
