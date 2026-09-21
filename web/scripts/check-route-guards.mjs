#!/usr/bin/env node
/**
 * Automated Route Guard Verification Script (BRAWUKA-181 / B-STD-2,
 * BRAWUKA-537 / spec 0011 D5)
 *
 * Enforces that every API route handler under web/app/api (except the
 * exemption list) is exported through `apiRoute(...)` — the wrapper owns
 * request-id, origin check, guard() (auth + rate limit), and the error
 * catch-all. Bare `export function METHOD`, direct `guard()` /
 * `requireSameOrigin()` calls in route files, and mutating exports without
 * `origin: true` are violations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
// Explicitly exempted routes with documented architectural reasons (spec 0011 D5)
const EXEMPT_ROUTES = new Set([
  "app/api/health/route.ts", // Lightweight probe for Docker / Dokploy / Traefik
  "app/cafes/[id]/og-image/route.tsx", // Image bytes, not the JSON envelope
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
    violations.push(...checkRouteFile(relPath, readFileSync(filePath, "utf-8")));
  }

  return violations;
}

function checkRouteFile(relPath, content) {
  const violations = [];

  // Check for deprecated raw rate limit primitives
  if (content.includes("checkRateLimit(")) {
    violations.push({
      file: relPath,
      reason: "Direct call to checkRateLimit() found; must use apiRoute() wrapper",
    });
  }
  if (content.includes("rateLimitResponse(")) {
    violations.push({
      file: relPath,
      reason: "Direct call to rateLimitResponse() found; must use apiRoute() wrapper",
    });
  }

  // Strip comments to check actual calls, not imports or comments
  const strippedContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  // The wrapper owns guard() and requireSameOrigin() — route files must
  // not call them directly.
  if (/\bguard\s*\(/.test(strippedContent)) {
    violations.push({
      file: relPath,
      reason: "Direct call to guard() found; must use apiRoute() wrapper",
    });
  }
  if (/\brequireSameOrigin\s*\(/.test(strippedContent)) {
    violations.push({
      file: relPath,
      reason: "Direct call to requireSameOrigin() found; pass origin: true to apiRoute()",
    });
  }

  // Check exported HTTP methods
  for (const method of HTTP_METHODS) {
    const bareFn = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`);
    if (bareFn.test(content)) {
      violations.push({
        file: relPath,
        method,
        reason: `Exported handler ${method} is a bare function; must be export const ${method} = apiRoute(...)`,
      });
      continue;
    }
    const wrapped = new RegExp(
      `export\\s+const\\s+${method}\\s*=\\s*apiRoute(?:<[^>]*>)?\\s*\\(\\s*\\{([^}]*)\\}`,
    );
    const match = content.match(wrapped);
    if (!match) continue; // method not exported
    if (MUTATING_METHODS.has(method) && !/\borigin\s*:\s*true\b/.test(match[1])) {
      violations.push({
        file: relPath,
        method,
        reason: `Mutating handler ${method} missing origin: true in apiRoute() options`,
      });
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
