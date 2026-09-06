import fs from "node:fs";
import path from "node:path";

export const BOOT_TIME = new Date().toISOString();

export function resolveAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  if (process.env.RELEASE_TAG) return process.env.RELEASE_TAG;
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  try {
    const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");
    if (fs.existsSync(buildIdPath)) {
      return fs.readFileSync(buildIdPath, "utf8").trim();
    }
  } catch {
    // Graceful fallback if filesystem access fails
  }
  return "development";
}
