import { configDefaults, defineConfig } from "vitest/config";
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
    // Agent worktrees under .claude/ are full copies of the repo. Left in, their
    // tests run alongside ours and every count is multiplied.
    exclude: [...configDefaults.exclude, ".claude/**"],
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
      // Without `include`, v8 only reports files a test happens to import,
      // which hides never-loaded source and inflates the percentages.
      include: ["src/**/*.ts"],
      exclude: [
        "tests/**",
        "**/*.test.ts",
        "**/*.d.ts",
        "scripts/**",
        "dist/**",
      ],
      // Measured for v26 with include: src/** (lines 44.22, statements 44.05,
      // functions 49.64, branches 38.99). Each threshold is one point under,
      // rounded down: v8 counts differ slightly between Node versions and CI
      // runs two. Raise them as coverage improves; never lower them to make a
      // run pass.
      thresholds: {
        lines: 43,
        functions: 48,
        branches: 37,
        statements: 43,
      },
    },
  },
});
