import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // `include` already limits collection to `*.test.*`; `tests/helpers/**` is
    // excluded by that alone — explicit `exclude` remains only for `node_modules`.
    exclude: ["node_modules/**", "**/.next/**", "**/coverage/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "@shared": path.resolve(import.meta.dirname, "./shared"),
      "server-only": path.resolve(import.meta.dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
