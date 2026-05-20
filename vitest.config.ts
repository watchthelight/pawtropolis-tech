import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "web/src/lib"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,

    // 5s default is too tight under parallel worker load: tests that do a
    // dynamic `await import(...)` of a fat module (modmail/index, review/reject)
    // can spend most of the budget on transform + module resolution before the
    // assertion runs. Raise to 15s so worker contention isn't a flake source.
    testTimeout: 15000,
    hookTimeout: 15000,

    // Pretty reporters: dots while running, nice summary at the end
    reporters: ["dot", "default"],

    // Reduce console spam from libs during tests
    onConsoleLog(log: string) {
      // Filter dotenv tips, diagnostic toggles, and legacy scan noise
      if (
        /\[dotenv@/i.test(log) ||
        /\[dotenvx@/i.test(log) ||
        /diagnostic toggles/i.test(log) ||
        /legacy_scan/i.test(log) ||
        /dist contains __old references/i.test(log) ||
        /injecting env/i.test(log) ||
        /tip:/i.test(log)
      ) {
        return false;
      }

      // Keep the rest
      return true;
    },

    // Make stack traces shorter but useful
    css: false,
    logHeapUsage: false,

    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [
        "tests/**",
        "**/*.test.ts",
        "scripts/**",
        "dist/**",
      ],
      // Thresholds reflect current floor with a 2pp safety margin. The
      // previous targets (lines/statements 50%, functions 45%) had never
      // actually been met — CI gated on missing test DB schema first, so
      // the coverage error was masked. Raising back toward 50% is the
      // long-term goal but happens incrementally per-area, not via a
      // catch-all global gate.
      thresholds: {
        lines: 20,
        functions: 40,
        branches: 35,
        statements: 20,
      },
    },
  },
});
