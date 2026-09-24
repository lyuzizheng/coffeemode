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
import ts from "typescript";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"];
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
// Explicitly exempted routes with documented architectural reasons (spec 0011 D5)
const EXEMPT_ROUTES = new Set([
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

function getCallIdentifier(expr) {
  while (ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  return undefined;
}

function checkDisallowedCalls(sf, relPath) {
  const violations = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callName = getCallIdentifier(node.expression);
      if (callName === "checkRateLimit" || callName === "rateLimitResponse" || callName === "guard") {
        violations.push({
          file: relPath,
          reason: `Direct call to ${callName}() found; must use apiRoute() wrapper`,
        });
      } else if (callName === "requireSameOrigin") {
        violations.push({
          file: relPath,
          reason: "Direct call to requireSameOrigin() found; pass origin: true to apiRoute()",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return violations;
}

function hasTrueProperty(objectLiteral, propertyName) {
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
      ? prop.name.text
      : undefined;
    if (name === propertyName && prop.initializer?.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }
  }
  return false;
}

function validateApiRouteOptions(method, optionsArg, relPath) {
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) {
    return [{
      file: relPath,
      method,
      reason: MUTATING_METHODS.has(method)
        ? `Mutating handler ${method} missing origin: true in apiRoute() options (options must be an inline object literal)`
        : `Handler ${method} apiRoute() options must be an inline object literal`,
    }];
  }

  if (optionsArg.properties.some((p) => ts.isSpreadAssignment(p))) {
    return [{
      file: relPath,
      method,
      reason: MUTATING_METHODS.has(method)
        ? `Mutating handler ${method} missing origin: true in apiRoute() options (spread options are not allowed)`
        : `Handler ${method} apiRoute() options must not use spread assignments`,
    }];
  }

  if (MUTATING_METHODS.has(method) && !hasTrueProperty(optionsArg, "origin")) {
    return [{
      file: relPath,
      method,
      reason: `Mutating handler ${method} missing origin: true in apiRoute() options`,
    }];
  }

  return [];
}

function checkVariableMethod(decl, relPath) {
  const method = ts.isIdentifier(decl.name) ? decl.name.text : undefined;
  if (!method || !HTTP_METHODS.includes(method)) return [];

  const init = decl.initializer;
  if (!init || !ts.isCallExpression(init) || getCallIdentifier(init.expression) !== "apiRoute") {
    return [{
      file: relPath,
      method,
      reason: `Exported handler ${method} is a bare function; must be export const ${method} = apiRoute(...)`,
    }];
  }

  return validateApiRouteOptions(method, init.arguments[0], relPath);
}

function checkExportStatement(stmt, relPath) {
  if (ts.isFunctionDeclaration(stmt)) {
    const method = stmt.name?.text;
    if (method && HTTP_METHODS.includes(method)) {
      return [{
        file: relPath,
        method,
        reason: `Exported handler ${method} is a bare function; must be export const ${method} = apiRoute(...)`,
      }];
    }
    return [];
  }

  if (ts.isVariableStatement(stmt)) {
    const violations = [];
    for (const decl of stmt.declarationList.declarations) {
      violations.push(...checkVariableMethod(decl, relPath));
    }
    return violations;
  }

  if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    const violations = [];
    for (const elem of stmt.exportClause.elements) {
      const method = elem.name.text;
      if (HTTP_METHODS.includes(method)) {
        violations.push({
          file: relPath,
          method,
          reason: `Exported handler ${method} must be export const ${method} = apiRoute(...)`,
        });
      }
    }
    return violations;
  }

  return [];
}

export function checkRouteFile(relPath, content) {
  const sf = ts.createSourceFile(
    relPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations = checkDisallowedCalls(sf, relPath);

  for (const stmt of sf.statements) {
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported && !ts.isExportDeclaration(stmt)) continue;
    violations.push(...checkExportStatement(stmt, relPath));
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
