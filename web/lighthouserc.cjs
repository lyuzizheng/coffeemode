/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const appYamlPath = path.join(__dirname, "config", "app.yaml");
let lighthouseThresholds = {
  performance: 0.8,
  accessibility: 0.85,
  bestPractices: 0.85,
  seo: 0.85,
};

try {
  if (fs.existsSync(appYamlPath)) {
    const parsed = parse(fs.readFileSync(appYamlPath, "utf8"));
    if (parsed?.budgets?.lighthouse) {
      lighthouseThresholds = parsed.budgets.lighthouse;
    }
  }
} catch (err) {
  console.warn("Failed to load budgets.lighthouse from config/app.yaml:", err.message);
}

const port = Number(process.env.LHCI_PORT ?? 3109);
const host = process.env.LHCI_HOST ?? "127.0.0.1";
const baseUrl = process.env.LHCI_BASE_URL ?? `http://${host}:${port}`;
const E2E_CAFE_ID = "e2e00000-0000-4000-a000-000000000002";

module.exports = {
  ci: {
    collect: {
      url: [
        `${baseUrl}/`,
        `${baseUrl}/cafes/${E2E_CAFE_ID}`,
      ],
      numberOfRuns: 3,
      settings: {
        chromeFlags: "--no-sandbox --headless --disable-gpu --disable-dev-shm-usage",
        // Calibrate simulated CPU multiplier for virtualized CI containers
        // to prevent false positives from shared runner CPU contention.
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 2,
        },
      },
    },
    assert: {
      // Per-URL performance floors (map-home BRAWUKA-311, deeplink BRAWUKA-514):
      // `/` is a WebGL map surface and `/cafes/[id]` hydrates into the same
      // app under its SSR shell — neither can hold the static-scaffold 0.8,
      // so each gets a calibrated floor (budgets.lighthouse.performanceHome /
      // .performanceCafe). assertMatrix can't mix with top-level `assertions`,
      // so every rule lives in the matrix; the generic non-home row excludes
      // /cafes/ so only the calibrated row applies there.
      assertMatrix: [
        {
          matchingUrlPattern: ".*",
          assertions: {
            "categories:accessibility": ["error", { minScore: lighthouseThresholds.accessibility }],
            "categories:best-practices": ["error", { minScore: lighthouseThresholds.bestPractices }],
            "categories:seo": ["error", { minScore: lighthouseThresholds.seo }],
          },
        },
        {
          matchingUrlPattern: "^https?://[^/]+/$",
          assertions: {
            "categories:performance": ["error", { minScore: lighthouseThresholds.performanceHome }],
          },
        },
        {
          matchingUrlPattern: "^https?://[^/]+/cafes/",
          assertions: {
            "categories:performance": ["error", { minScore: lighthouseThresholds.performanceCafe }],
          },
        },
        {
          matchingUrlPattern: "^https?://[^/]+/(?!cafes/).+",
          assertions: {
            "categories:performance": ["error", { minScore: lighthouseThresholds.performance }],
          },
        },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
