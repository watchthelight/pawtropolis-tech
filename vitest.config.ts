import { defineConfig } from "vitest/config";

export default defineConfig({
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
      thresholds: {
        lines: 50,
        functions: 45,
        branches: 40,
        statements: 50,
      },
    },
  },
});
