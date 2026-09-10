#!/usr/bin/env node
/**
 * Automated Route Guard Verification Script (BRAWUKA-181 / B-STD-2)
 *
 * Enforces that every API route handler under web/app/api (except lightweight health check)
 * properly invokes `guard(...)` from `@/lib/api/guard` and does not leak unguarded
 * HTTP endpoints or use redundant local rate-limiting boilerplate.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

// Explicitly exempted routes with documented architectural reasons
const EXEMPT_ROUTES = new Set([
  "app/api/health/route.ts", // Lightweight probe for Docker / Dokploy / Traefik
]);

function findRouteFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      findRouteFiles(filePath, fileList);
    } else if (file === "route.ts" || file === "route.tsx") {
      fileList.push(filePath);
    }
  }
  return fileList;
}

export function checkRouteGuards(webRootDir) {
  const apiDir = join(webRootDir, "app/api");
  const routeFiles = findRouteFiles(apiDir);
  const ogImageRoute = join(webRootDir, "app/cafes/[id]/og-image/route.tsx");
  try {
    if (statSync(ogImageRoute).isFile()) {
      routeFiles.push(ogImageRoute);
    }
  } catch {
    // optional
  }

  const violations = [];

  for (const filePath of routeFiles) {
    const relPath = relative(webRootDir, filePath);
    if (EXEMPT_ROUTES.has(relPath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf-8");

    // Check for deprecated raw rate limit primitives
    if (content.includes("checkRateLimit(")) {
      violations.push({
        file: relPath,
        reason: "Direct call to checkRateLimit() found; must use guard() helper",
      });
    }
    if (content.includes("rateLimitResponse(")) {
      violations.push({
        file: relPath,
        reason: "Direct call to rateLimitResponse() found; must use guard() helper",
      });
    }

    // Check exported HTTP methods
    for (const method of HTTP_METHODS) {
      const exportRegex = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`);
      if (exportRegex.test(content)) {
        // Ensure guard( is called in the route file
        if (!content.includes("guard(")) {
          violations.push({
            file: relPath,
            method,
            reason: `Exported handler ${method} missing call to guard()`,
          });
        }
      }
    }
  }

  return violations;
}

// Run CLI if executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const violations = checkRouteGuards(webRoot);

  if (violations.length > 0) {
    console.error("❌ Route guard check failed with violations:");
    for (const v of violations) {
      console.error(`  - [${v.file}] ${v.method ? v.method + ": " : ""}${v.reason}`);
    }
    process.exit(1);
  } else {
    console.log("✅ All API routes properly invoke guard().");
  }
}
