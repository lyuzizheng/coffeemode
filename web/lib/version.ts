import fs from "node:fs";
import path from "node:path";

export const BOOT_TIME = new Date().toISOString();

function readBuildId(): string | null {
  try {
    const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");
    if (fs.existsSync(buildIdPath)) {
      const id = fs.readFileSync(buildIdPath, "utf8").trim();
      return id.length > 0 ? id : null;
    }
  } catch {
    // Graceful fallback if filesystem access fails
  }
  return null;
}

const BUILD_ID = readBuildId();

export function resolveAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  return BUILD_ID ?? "development";
}
